/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This script is a forked copy of the `install-kernel` script from the
 * positron-r extension; it is responsible for downloading a built copy of the
 * Kallichore server and/or using a locally built version.
 *
 * In the future, we could consider some way to share this script between the
 * two extensions (note that some URLs, paths, and messages are different) or
 * provide a shared library for downloading and installing binaries from Github
 * releases.
 */

import * as decompress from 'decompress';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import { platform, arch } from 'os';
import * as path from 'path';
import { promisify } from 'util';


// Promisify some filesystem functions.
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists);

// Create a promisified version of https.get. We can't use the built-in promisify
// because the callback doesn't follow the promise convention of (error, result).
const httpsGetAsync = (opts: https.RequestOptions) => {
	return new Promise<IncomingMessage>((resolve, reject) => {
		const req = https.get(opts, resolve);
		req.once('error', reject);
	});
};

/**
 * Gets the version of the Kallichore server specified in package.json.
 *
 * @returns The version of Kallichore specified in package.json, or null if it cannot be determined.
 */
async function getVersionFromPackageJson(): Promise<string | null> {
	try {
		const packageJson = JSON.parse(await readFileAsync('package.json', 'utf-8'));
		return packageJson.positron.binaryDependencies?.kallichore || null;
	} catch (error) {
		console.error('Error reading package.json: ', error);
		return null;
	}
}

/**
 * Gets the version of Kallichore installed locally by reading a `VERSION` file that's written
 * by this `install-kallichore-server` script.
 *
 * @returns The version of Kallichore installed locally, or null if it is not installed.
 */
async function getLocalKallichoreVersion(): Promise<string | null> {
	const versionFile = path.join('resources', 'kallichore', 'VERSION');
	try {
		const kallichoreExists = await existsAsync(versionFile);
		if (!kallichoreExists) {
			return null;
		}
		return readFileAsync(versionFile, 'utf-8');
	} catch (error) {
		console.error('Error determining Kallichore version: ', error);
		return null;
	}
}

/**
 * Helper to execute a command and return the stdout and stderr.
 *
 * @param command The command to execute.
 * @param stdin Optional stdin to pass to the command.
 * @returns A promise that resolves with the stdout and stderr of the command.
 */
async function executeCommand(command: string, stdin?: string):
	Promise<{ stdout: string; stderr: string }> {
	const { exec } = require('child_process');
	return new Promise((resolve, reject) => {
		const process = exec(command, (error: any, stdout: string, stderr: string) => {
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
 * Downloads the specified version of Kallichore and replaces the local binary.
 *
 * @param version The version of Kallichore to download.
 * @param githubPat A Github Personal Access Token with the appropriate rights
 *  to download the release.
 * @param gitCredential Whether the PAT originated from the `git credential` command.
 */
async function downloadAndReplaceKallichore(version: string,
	githubPat: string,
	gitCredential: boolean): Promise<void> {

	try {
		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github.v3.raw', // eslint-disable-line
			'User-Agent': 'positron-kallichore-downloader' // eslint-disable-line
		};
		// If we have a githubPat, set it for better rate limiting.
		if (githubPat) {
			headers.Authorization = `token ${githubPat}`;
		}
		const requestOptions: https.RequestOptions = {
			headers,
			method: 'GET',
			protocol: 'https:',
			hostname: 'api.github.com',
			path: `/repos/posit-dev/kallichore/releases`
		};

		const response = await httpsGetAsync(requestOptions as any) as any;

		// Special handling for PATs originating from `git credential`.
		if (gitCredential && response.statusCode === 200) {
			// If the PAT hasn't been approved yet, do so now. This stores the credential in
			// the system credential store (or whatever `git credential` uses on the system).
			// Without this step, the user will be prompted for a username and password the
			// next time they try to download Kallichore.
			const { stdout, stderr } =
				await executeCommand('git credential approve',
					`protocol=https\n` +
					`host=github.com\n` +
					`path=/repos/posit-dev/kallichore/releases\n` +
					`username=\n` +
					`password=${githubPat}\n`);
			console.log(stdout);
			if (stderr) {
				console.warn(`Unable to approve PAT. You may be prompted for a username and ` +
					`password the next time you download Kallichore.`);
				console.error(stderr);
			}
		} else if (gitCredential && response.statusCode > 400 && response.statusCode < 500) {
			// This handles the case wherein we got an invalid PAT from `git credential`. In this
			// case we need to clean up the PAT from the credential store, so that we don't
			// continue to use it.
			const { stdout, stderr } =
				await executeCommand('git credential reject',
					`protocol=https\n` +
					`host=github.com\n` +
					`path=/repos/posit-dev/kallichore/releases\n` +
					`username=\n` +
					`password=${githubPat}\n`);
			console.log(stdout);
			if (stderr) {
				console.error(stderr);
				throw new Error(`The stored PAT returned by 'git credential' is invalid, but\n` +
					`could not be removed. Please manually remove the PAT from 'git credential'\n` +
					`for the host 'github.com'`);
			}
			throw new Error(`The PAT returned by 'git credential' is invalid. Kallichore cannot be\n` +
				`downloaded.\n\n` +
				`Check to be sure that your Personal Access Token:\n` +
				'- Has the `repo` scope\n' +
				'- Is not expired\n' +
				'- Has been authorized for the "posit-dev" organization on Github (Configure SSO)\n');
		}

		let responseBody = '';

		response.on('data', (chunk: any) => {
			responseBody += chunk;
		});

		response.on('end', async () => {
			if (response.statusCode !== 200) {
				throw new Error(`Failed to download Kallichore: HTTP ${response.statusCode}\n\n` +
					`${responseBody}`);
			}
			const releases = JSON.parse(responseBody);
			if (!Array.isArray(releases)) {
				throw new Error(`Unexpected response from Github:\n\n` +
					`${responseBody}`);
			}
			const release = releases.find((asset: any) => asset.tag_name === version);
			if (!release) {
				console.error(`Could not find Kallichore ${version} in the releases.`);
				return;
			}

			let os: string;
			switch (platform()) {
				case 'win32': os = 'windows-x64'; break;
				case 'darwin': os = 'darwin-universal'; break;
				case 'linux': os = (arch() === 'arm64' ? 'linux-arm64' : 'linux-x64'); break;
				default: {
					console.error(`Unsupported platform ${platform()}.`);
					return;
				}
			}

			const assetName = `kallichore-${version}-${os}.zip`;
			const asset = release.assets.find((asset: any) => asset.name === assetName);
			if (!asset) {
				console.error(`Could not find Kallichore with asset name ${assetName} in the release.`);
				return;
			}
			console.log(`Downloading Kallichore ${version} from ${asset.url}...`);
			const url = new URL(asset.url);
			// Reset the Accept header to download the asset.
			headers.Accept = 'application/octet-stream';
			const requestOptions: https.RequestOptions = {
				headers,
				method: 'GET',
				protocol: url.protocol,
				hostname: url.hostname,
				path: url.pathname
			};

			let dlResponse = await httpsGetAsync(requestOptions) as any;
			while (dlResponse.statusCode === 302) {
				// Follow redirects.
				dlResponse = await httpsGetAsync(dlResponse.headers.location) as any;
			}
			let binaryData = Buffer.alloc(0);

			dlResponse.on('data', (chunk: any) => {
				binaryData = Buffer.concat([binaryData, chunk]);
			});
			dlResponse.on('end', async () => {
				const kallichoreDir = path.join('resources', 'kallichore');

				// Create the resources/kallichore directory if it doesn't exist.
				if (!await existsAsync(kallichoreDir)) {
					await fs.promises.mkdir(kallichoreDir);
				}

				console.log(`Successfully downloaded Kallichore ${version} (${binaryData.length} bytes).`);
				const zipFileDest = path.join(kallichoreDir, 'kallichore.zip');
				await writeFileAsync(zipFileDest, binaryData);

				await decompress(zipFileDest, kallichoreDir).then(_files => {
					console.log(`Successfully unzipped Kallichore ${version}.`);
				});

				// Clean up the zipfile.
				await fs.promises.unlink(zipFileDest);

				// Write a VERSION file with the version number.
				await writeFileAsync(path.join('resources', 'kallichore', 'VERSION'), version);

			});
		});
	} catch (error) {
		console.error('Error downloading Kallichore:', error);
	}
}

async function main() {
	const serverName = platform() === 'win32' ? 'kcserver.exe' : 'kcserver';

	// Before we do any work, check to see if there is a locally built copy of
	// Kallichore in the `kallichore / target` directory. If so, we'll assume
	// that the user is a Kallichore developer and skip the download; this
	// version will take precedence over any downloaded version.
	const positronParent = path.dirname(path.dirname(path.dirname(path.dirname(__dirname))));
	const kallichoreFolder = path.join(positronParent, 'kallichore');
	const targetFolder = path.join(kallichoreFolder, 'target');
	const debugBinary = path.join(targetFolder, 'debug', serverName);
	const releaseBinary = path.join(targetFolder, 'release', serverName);
	if (fs.existsSync(debugBinary) || fs.existsSync(releaseBinary)) {
		const binary = fs.existsSync(debugBinary) ? debugBinary : releaseBinary;
		console.log(`Using locally built Kallichore in ${binary}.`);

		// Copy the locally built Kallichore to the resources/kallichore
		// directory. It won't be read from this directory at runtime, but we
		// need to put it here so that `yarn gulp vscode` will package it up
		// (the packaging step doesn't look for a sideloaded Kallichore from an
		// adjacent `Kallichore` directory).
		fs.mkdirSync(path.join('resources', 'kallichore'), { recursive: true });
		fs.copyFileSync(binary, path.join('resources', 'kallichore', serverName));
		return;
	} else {
		console.log(`No locally built Kallichore found in ${path.join(positronParent, 'kallichore')}; ` +
			`checking downloaded version.`);
	}

	const packageJsonVersion = await getVersionFromPackageJson();
	const localKallichoreVersion = await getLocalKallichoreVersion();

	if (!packageJsonVersion) {
		console.error('Could not determine Kallichore version from package.json.');
		return;
	}

	console.log(`package.json version: ${packageJsonVersion} `);
	console.log(`Downloaded Kallichore version: ${localKallichoreVersion ? localKallichoreVersion : 'Not found'} `);

	if (packageJsonVersion === localKallichoreVersion) {
		console.log('Versions match. No action required.');
		return;
	}

	// We need a Github Personal Access Token (PAT) to download Kallichore. Because this is sensitive
	// information, there are a lot of ways to set it. We try the following in order:

	// (1) The GITHUB_PAT environment variable.
	// (2) The POSITRON_GITHUB_PAT environment variable.
	// (3) The git config setting 'credential.https://api.github.com.token'.
	// (4) The git credential store.

	// (1) Get the GITHUB_PAT from the environment.
	let githubPat = process.env.GITHUB_PAT;
	let gitCredential = false;
	if (githubPat) {
		console.log('Using Github PAT from environment variable GITHUB_PAT.');
	} else {
		// (2) Try POSITRON_GITHUB_PAT (it's what the build script sets)
		githubPat = process.env.POSITRON_GITHUB_PAT;
		if (githubPat) {
			console.log('Using Github PAT from environment variable POSITRON_GITHUB_PAT.');
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
			} else {
				console.error(stderr);
			}
		} catch (error) {
			// We don't care if this fails; we'll try `git credential` next.
		}
	}

	// (4) If no GITHUB_PAT is set, try to get it from git credential.
	if (!githubPat) {
		// Explain to the user what's about to happen.
		console.log(`Attempting to retrieve a Github Personal Access Token from git in order\n` +
			`to download Kallichore ${packageJsonVersion}. If you are prompted for a username and\n` +
			`password, enter your Github username and a Personal Access Token with the\n` +
			`'repo' scope. You can read about how to create a Personal Access Token here: \n` +
			`\n` +
			`https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens\n` +
			`\n` +
			`If you don't want to set up a Personal Access Token now, just press Enter twice to set \n` +
			`a blank value for the password. Kallichore will not be downloaded. \n` +
			`\n` +
			`You can set a PAT later by running yarn again and supplying the PAT at this prompt,\n` +
			`or by running 'git config credential.https://api.github.com.token YOUR_GITHUB_PAT'\n`);
		const { stdout, stderr } =
			await executeCommand('git credential fill',
				`protocol=https\n` +
				`host=github.com\n` +
				`path=/repos/posit-dev/kallichore/releases\n`);

		gitCredential = true;
		// Extract the `password = ` line from the output.
		const passwordLine = stdout.split('\n').find(
			(line: string) => line.startsWith('password='));
		if (passwordLine) {
			githubPat = passwordLine.split('=')[1];
			console.log(`Using Github PAT returned from 'git credential'.`);
		} else {
			console.error(stderr);
		}
	}

	if (!githubPat) {
		console.log(`No Github PAT was found. Unable to download Kallichore ${packageJsonVersion}.`);
		return;
	}

	await downloadAndReplaceKallichore(packageJsonVersion, githubPat, gitCredential);
}

main().catch((error) => {
	console.error('An error occurred:', error);
});
