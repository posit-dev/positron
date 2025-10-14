/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as decompress from 'decompress';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as os from 'os';
import { platform, arch } from 'os';
import * as path from 'path';
import { promisify } from 'util';


// Promisify some filesystem functions.
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists);
const mkdtempAsync = promisify(fs.mkdtemp);

// Create a promisified version of https.get. We can't use the built-in promisify
// because the callback doesn't follow the promise convention of (error, result).
const httpsGetAsync = (opts: https.RequestOptions | string | URL) => {
	return new Promise<IncomingMessage>((resolve, reject) => {
		const req = https.get(opts, resolve);
		req.once('error', reject);
	});
};

const readResponseBody = async (response: IncomingMessage): Promise<Buffer> => {
	return await new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		response.on('data', chunk => {
			chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
		});
		response.once('end', () => resolve(Buffer.concat(chunks)));
		response.once('error', reject);
	});
};

interface ArkAssetTarget {
	readonly assetSuffix: string;
	readonly subdirectory?: string;
	readonly label: string;
}

const redirectStatusCodes = new Set([301, 302, 307, 308]);

type NodeArch = ReturnType<typeof arch>;

function getDownloadTargets(currentPlatform: NodeJS.Platform, currentArch: NodeArch): ArkAssetTarget[] {
	switch (currentPlatform) {
		case 'win32':
			return [
				{ assetSuffix: 'windows-arm64', subdirectory: 'windows-arm64', label: 'Windows ARM64' },
				{ assetSuffix: 'windows-x64', subdirectory: 'windows-x64', label: 'Windows x64' }
			];
		case 'darwin':
			return [{ assetSuffix: 'darwin-universal', label: 'macOS Universal' }];
		case 'linux':
			return [{
				assetSuffix: currentArch === 'arm64' ? 'linux-arm64' : 'linux-x64',
				label: currentArch === 'arm64' ? 'Linux ARM64' : 'Linux x64'
			}];
		default:
			throw new Error(`Unsupported platform ${currentPlatform}.`);
	}
}

function buildRequestOptions(url: URL, headers: Record<string, string>): https.RequestOptions {
	return {
		headers,
		method: 'GET',
		protocol: url.protocol,
		hostname: url.hostname,
		path: `${url.pathname}${url.search}`
	};
}

async function downloadReleaseAsset(assetUrl: string, headers: Record<string, string>): Promise<Buffer> {
	let requestUrl = new URL(assetUrl);
	let response = await httpsGetAsync(buildRequestOptions(requestUrl, headers));
	while (response.statusCode && redirectStatusCodes.has(response.statusCode)) {
		const location = response.headers.location;
		if (!location) {
			throw new Error('Redirect response missing Location header while downloading Ark asset.');
		}
		requestUrl = new URL(location);
		response = await httpsGetAsync(buildRequestOptions(requestUrl, headers));
	}
	if (response.statusCode !== 200) {
		const body = await readResponseBody(response);
		throw new Error(`Failed to download Ark: HTTP ${response.statusCode}\n\n${body.toString('utf-8')}`);
	}
	return await readResponseBody(response);
}

/**
 * Gets the version of Ark specified in package.json.
 *
 * @returns The version of Ark specified in package.json, or null if it cannot be determined.
 */
async function getVersionFromPackageJson(): Promise<string | null> {
	try {
		const packageJson = JSON.parse(await readFileAsync('package.json', 'utf-8'));
		return packageJson.positron.binaryDependencies?.ark || null;
	} catch (error) {
		throw new Error(`Error reading package.json: ${error}`);
	}
}

/**
 * Gets the version of Ark installed locally by reading a `VERSION` file that's written
 * by this `install-kernel` script.
 *
 * @returns The version of Ark installed locally, or null if ark is not installed.
 */
async function getLocalArkVersion(): Promise<string | null> {
	const versionFile = path.join('resources', 'ark', 'VERSION');
	try {
		const arkExists = await existsAsync(versionFile);
		if (!arkExists) {
			return null;
		}
		return readFileAsync(versionFile, 'utf-8');
	} catch (error) {
		throw new Error(`Error determining ARK version: ${error}`);
	}
}

/**
 * Helper to execute a command and return the stdout and stderr.
 *
 * @param command The command to execute.
 * @param stdin Optional stdin to pass to the command.
 * @param cwd Optional working directory for the command
 * @returns A promise that resolves with the stdout and stderr of the command.
 */
async function executeCommand(
	command: string,
	stdin?: string,
	cwd?: string
): Promise<{ stdout: string; stderr: string }> {
	const { exec } = require('child_process');
	return new Promise((resolve, reject) => {
		const options: { cwd?: string } = {};
		if (cwd) {
			options.cwd = cwd;
		}

		const process = exec(command, options, (error: any, stdout: string, stderr: string) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});

		if (stdin) {
			process.stdin.write(stdin);
			process.stdin.end();
		}
	});
}

/**
 * Downloads the specified version of Ark and replaces the local binary.
 *
 * @param version The version of Ark to download.
 * @param githubPat An optional Github Personal Access Token with the appropriate rights
 *  to download the release.
 */
async function downloadAndReplaceArk(version: string,
	githubPat: string | undefined): Promise<void> {

	try {
		const baseHeaders: Record<string, string> = {
			'Accept': 'application/vnd.github.v3.raw', // eslint-disable-line
			'User-Agent': 'positron-ark-downloader' // eslint-disable-line
		};
		if (githubPat) {
			baseHeaders.Authorization = `token ${githubPat}`;
		}

		const releasesResponse = await httpsGetAsync({
			headers: baseHeaders,
			method: 'GET',
			protocol: 'https:',
			hostname: 'api.github.com',
			path: '/repos/posit-dev/ark/releases'
		} as https.RequestOptions);
		const releasesBuffer = await readResponseBody(releasesResponse);
		if (releasesResponse.statusCode !== 200) {
			throw new Error(`Failed to download Ark: HTTP ${releasesResponse.statusCode}\n\n${releasesBuffer.toString('utf-8')}`);
		}

		const releases = JSON.parse(releasesBuffer.toString('utf-8'));
		if (!Array.isArray(releases)) {
			throw new Error(`Unexpected response from Github:\n\n${releasesBuffer.toString('utf-8')}`);
		}
		const release = releases.find((asset: any) => asset.tag_name === version);
		if (!release) {
			throw new Error(`Could not find Ark ${version} in the releases.`);
		}

		const currentPlatform = platform() as NodeJS.Platform;
		const currentArch = arch();
		const targets = getDownloadTargets(currentPlatform, currentArch);
		const arkDir = path.join('resources', 'ark');
		await fs.promises.mkdir(arkDir, { recursive: true });

		if (currentPlatform === 'win32') {
			const legacyKernelPath = path.join(arkDir, 'ark.exe');
			if (await existsAsync(legacyKernelPath)) {
				await fs.promises.unlink(legacyKernelPath);
			}
		}

		for (const target of targets) {
			const assetName = `ark-${version}-${target.assetSuffix}.zip`;
			const asset = release.assets?.find((item: any) => item.name === assetName);
			if (!asset) {
				throw new Error(`Could not find Ark with asset name ${assetName} in the release.`);
			}

			console.log(`Downloading Ark ${version} (${target.label}) from ${asset.url}...`);
			const assetHeaders = {
				...baseHeaders,
				Accept: 'application/octet-stream'
			};
			const binaryData = await downloadReleaseAsset(asset.url, assetHeaders);

			if (binaryData.length < 1024) {
				console.error(binaryData.toString('utf-8'));
				throw new Error(`Binary data is too small (${binaryData.length} bytes); download probably failed.`);
			}

			const targetDir = target.subdirectory ? path.join(arkDir, target.subdirectory) : arkDir;
			if (target.subdirectory) {
				await fs.promises.rm(targetDir, { recursive: true, force: true });
			}
			await fs.promises.mkdir(targetDir, { recursive: true });

			const zipFileDest = path.join(targetDir, 'ark.zip');
			await writeFileAsync(zipFileDest, binaryData);
			await decompress(zipFileDest, targetDir);
			await fs.promises.unlink(zipFileDest);
			console.log(`Successfully installed Ark ${version} (${target.label}).`);
		}

		await writeFileAsync(path.join('resources', 'ark', 'VERSION'), version);
	} catch (error) {
		throw new Error(`Error downloading Ark: ${error}`);
	}
}

/**
 * Downloads and builds Ark from a GitHub repository at a specific branch or revision.
 *
 * This function supports development workflows by allowing developers to:
 * - Test changes from non-released branches
 * - Use experimental features not yet in a release
 * - Develop against the latest code in a repository
 *
 * IMPORTANT: This feature is for DEVELOPMENT ONLY and should not be used in
 * production environments or merged to main branches. A GitHub Action enforces
 * this restriction by blocking PRs with repo references in package.json.
 *
 * @param ref The GitHub repo reference in the format 'org/repo@branch_or_revision'
 * @param githubPat An optional Github Personal Access Token
 */
async function downloadFromGitHubRepository(
	ref: string,
	githubPat: string | undefined
): Promise<void> {
	const { org, repo, revision } = parseGitHubRepoReference(ref);

	console.log(`Downloading and building Ark from GitHub repo: ${org}/${repo} at revision: ${revision}`);

	// Create a temporary directory for cloning the repo
	const tempDir = await mkdtempAsync(path.join(os.tmpdir(), 'ark-build-'));

	try {
		console.log(`Created temporary build directory: ${tempDir}`);

		// Set up git command with credentials if available
		let gitCloneCommand = `git clone https://github.com/${org}/${repo}.git ${tempDir}`;
		if (githubPat) {
			gitCloneCommand = `git clone https://x-access-token:${githubPat}@github.com/${org}/${repo}.git ${tempDir}`;
		}

		// Clone the repository
		console.log('Cloning repository...');
		await executeCommand(gitCloneCommand);

		// Checkout the specific revision
		console.log(`Checking out revision: ${revision}`);
		await executeCommand(`git checkout ${revision}`, undefined, tempDir);

		// Verify that we have a valid Ark repository structure
		const cargoTomlPath = path.join(tempDir, 'Cargo.toml');
		if (!await existsAsync(cargoTomlPath)) {
			throw new Error(`Invalid Ark repository: Cargo.toml not found at the repository root`);
		}

		console.log('Building Ark from source...');

		const buildOutput = await executeCommand('cargo build --release', undefined, tempDir);
		console.log('Ark build stdout:', buildOutput.stdout);
		console.log('Ark build stderr:', buildOutput.stderr);

		// Determine the location of the built binary
		const kernelName = platform() === 'win32' ? 'ark.exe' : 'ark';
		const binaryPath = path.join(tempDir, 'target', 'release', kernelName);

		// Ensure the binary was built successfully
		if (!fs.existsSync(binaryPath)) {
			throw new Error(`Failed to build Ark binary at ${binaryPath}`);
		}

		// Run the binary and check output. An error will be thrown if this fails.
		const { stdout: versionStdout, stderr: versionStderr } = await executeCommand(`${binaryPath}`);
		console.log('Ark stdout:', versionStdout);
		console.log('Ark stderr:', versionStderr);

		// Create the resources/ark directory if it doesn't exist
		const arkDir = path.join('resources', 'ark');
		await fs.promises.mkdir(arkDir, { recursive: true });

		// Copy the binary to the resources directory (root) so packaging picks it up
		await fs.promises.copyFile(binaryPath, path.join(arkDir, kernelName));

		// On Windows, also place the binary inside the architecture-specific subdirectory
		if (platform() === 'win32') {
			const windowsSubdir = process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
			const targetDir = path.join(arkDir, windowsSubdir);
			await fs.promises.mkdir(targetDir, { recursive: true });
			await fs.promises.copyFile(binaryPath, path.join(targetDir, kernelName));
		}
		console.log(`Successfully built and installed Ark from ${org}/${repo}@${revision}`);

		// Write the version information to VERSION file
		await writeFileAsync(path.join(arkDir, 'VERSION'), ref);

	} catch (err) {
		throw new Error(`Error building Ark from GitHub repository: ${err}`);
	} finally {
		// Clean up the temporary directory
		try {
			await fs.promises.rm(tempDir, { recursive: true, force: true });
		} catch (err) {
			console.warn(`Warning: Failed to clean up temporary directory ${tempDir}: ${err}`);
		}
	}
}

async function main() {
	const kernelName = platform() === 'win32' ? 'ark.exe' : 'ark';

	// Before we do any work, check to see if there is a locally built copy of
	// the Ark R Kernel in the `ark / target` directory. If so, we'll assume
	// that the user is a kernel developer and skip the download; this version
	// will take precedence over any downloaded version.
	const positronParent = path.dirname(path.dirname(path.dirname(path.dirname(__dirname))));
	const arkFolder = path.join(positronParent, 'ark');
	const targetFolder = path.join(arkFolder, 'target');
	const debugBinary = path.join(targetFolder, 'debug', kernelName);
	const releaseBinary = path.join(targetFolder, 'release', kernelName);
	if (fs.existsSync(debugBinary) || fs.existsSync(releaseBinary)) {
		const binary = fs.existsSync(debugBinary) ? debugBinary : releaseBinary;
		console.log(`Using locally built Ark in ${binary}.`);

		// Copy the locally built ark to the resources/ark directory. It won't
		// be read from this directory at runtime, but we need to put it here
		// so that `yarn gulp vscode` will package it up (the packaging step
		// doesn't look for a sideloaded ark from an adjacent `ark` directory).
		fs.mkdirSync(path.join('resources', 'ark'), { recursive: true });
		fs.copyFileSync(binary, path.join('resources', 'ark', kernelName));
		return;
	} else {
		console.log(`No locally built Ark found in ${path.join(positronParent, 'ark')}; ` +
			`checking downloaded version.`);
	}

	const packageJsonVersion = await getVersionFromPackageJson();
	const localArkVersion = await getLocalArkVersion();

	if (!packageJsonVersion) {
		throw new Error('Could not determine Ark version from package.json.');
	}

	console.log(`package.json version: ${packageJsonVersion} `);
	console.log(`Downloaded ark version: ${localArkVersion ? localArkVersion : 'Not found'} `);

	// Skip installation if versions match
	if (packageJsonVersion === localArkVersion) {
		console.log('Versions match. No action required.');
		return;
	}

	// We can optionally use a Github Personal Access Token (PAT) to download
	// Ark. Because this is sensitive information, there are a lot of ways to
	// set it. We try the following in order:

	// (1) The GITHUB_PAT environment variable.
	// (2) The POSITRON_GITHUB_RO_PAT environment variable.
	// (3) The git config setting 'credential.https://api.github.com.token'.

	// (1) Get the GITHUB_PAT from the environment.
	let githubPat = process.env.GITHUB_PAT;
	if (githubPat) {
		console.log('Using Github PAT from environment variable GITHUB_PAT.');
	} else {
		// (2) Try POSITRON_GITHUB_RO_PAT (it's what the build script sets)
		githubPat = process.env.POSITRON_GITHUB_RO_PAT;
		if (githubPat) {
			console.log('Using Github PAT from environment variable POSITRON_GITHUB_RO_PAT.');
		}
	}

	// (3) If no GITHUB_PAT is set, try to get it from git config. This provides a
	// convenient non-interactive way to set the PAT.
	if (!githubPat) {
		try {
			const { stdout, stderr } =
				await executeCommand('git config --get credential.https://api.github.com.token');
			githubPat = stdout.trim();
			if (githubPat) {
				console.log(`Using Github PAT from git config setting ` +
					`'credential.https://api.github.com.token'.`);
			}
		} catch (error) {
			// We don't care if this fails; we'll without a PAT.
		}
	}

	// Check if the version is a GitHub repo reference
	if (isGitHubRepoReference(packageJsonVersion)) {
		await downloadFromGitHubRepository(packageJsonVersion, githubPat);
	} else {
		await downloadAndReplaceArk(packageJsonVersion, githubPat);
	}
}

/**
 * Check if the version string follows the format 'org/repo@branch_or_revision'.
 */
function isGitHubRepoReference(version: string): boolean {
	return /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+@[a-zA-Z0-9._\/-]+$/.test(version);
}

/**
 * Parse a GitHub repo reference in the format 'org/repo@branch_or_revision'.
 */
function parseGitHubRepoReference(reference: string): { org: string; repo: string; revision: string } {
	const orgRepoMatch = reference.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)@([a-zA-Z0-9._\/-]+)$/);
	if (!orgRepoMatch) {
		throw new Error(`Invalid GitHub repo reference: ${reference}`);
	}

	return {
		org: orgRepoMatch[1],
		repo: orgRepoMatch[2],
		revision: orgRepoMatch[3]
	};
}

main().catch((error) => {
	console.error('An error occurred:', error);
});
