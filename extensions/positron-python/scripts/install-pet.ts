/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as decompress from 'decompress';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as path from 'path';
import { promisify } from 'util';

/**
 * This script is a forked copy of the `install-kernel` script from the
 * positron-r and positron-supervisor extension; it is responsible for downloading
 * a copy of the Python Environment Tools repo and/or using a local version.
 *
 * In the future, we could consider some way to share this script between the
 * extensions (note that some URLs, paths, and messages are different) or
 * provide a shared library for downloading and installing binaries from Github
 * releases.
 */

// Promisify some filesystem functions.
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists);

// Create a promisified version of https.get. We can't use the built-in promisify
// because the callback doesn't follow the promise convention of (error, result).
export const httpsGetAsync = (opts: https.RequestOptions) => {
	return new Promise<IncomingMessage>((resolve, reject) => {
		const req = https.get(opts, resolve);
		req.once('error', reject);
	});
};

/**
 * Gets the version of Python Environment Tool specified in package.json.
 *
 * @returns The version of Python Environment Tool specified in package.json, or null if it cannot be determined.
 */
async function getVersionFromPackageJson(): Promise<string | null> {
	try {
		const packageJson = JSON.parse(await readFileAsync('package.json', 'utf-8'));
		return packageJson.positron.externalDependencies?.pet || null;
	} catch (error) {
		throw new Error(`Error reading package.json: ${error}`);
	}
}

/**
 * Gets the version of Python Environment Tools installed locally by reading a `VERSION` file that's written
 * by this `install-kernel` script.
 *
 * @returns The version of Python Environment Tool installed locally, or null if PET is not installed.
 */
async function getLocalPetVersion(): Promise<string | null> {
	const versionFile = path.join('resources', 'pet', 'VERSION');
	try {
		const petExists = await existsAsync(versionFile);
		if (!petExists) {
			return null;
		}
		return readFileAsync(versionFile, 'utf-8');
	} catch (error) {
		throw new Error(`Error determining Python Environment Tools version: ${error}`);
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
 * Downloads the specified version of Python Environment Tool and replaces the local directory.
 *
 * @param version The version of Python Environment Tool to download.
 * @param githubPat A Github Personal Access Token with the appropriate rights
 *  to download the release.
 * @param gitCredential Whether the PAT originated from the `git credential` command.
 */
async function downloadAndReplacePet(version: string,
	githubPat: string,
	gitCredential: boolean): Promise<void> {

	try {
		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github.v3.raw', // eslint-disable-line
			'User-Agent': 'positron-pet-downloader' // eslint-disable-line
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
			path: `/repos/microsoft/python-environment-tools/releases`
		};

		const response = await httpsGetAsync(requestOptions as any) as any;

		// Special handling for PATs originating from `git credential`.
		if (gitCredential && response.statusCode === 200) {
			// If the PAT hasn't been approved yet, do so now. This stores the credential in
			// the system credential store (or whatever `git credential` uses on the system).
			// Without this step, the user will be prompted for a username and password the
			// next time they try to download PET.
			const { stdout, stderr } =
				await executeCommand('git credential approve',
					`protocol=https\n` +
					`host=github.com\n` +
					`path=/repos/microsoft/python-environment-tools/releases\n` +
					`username=\n` +
					`password=${githubPat}\n`);
			console.log(stdout);
			if (stderr) {
				console.warn(`Unable to approve PAT. You may be prompted for a username and ` +
					`password the next time you download Python Environment Tools.`);
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
					`path=/repos/microsoft/python-environment-tools/releases\n` +
					`username=\n` +
					`password=${githubPat}\n`);
			console.log(stdout);
			if (stderr) {
				console.error(stderr);
				throw new Error(`The stored PAT returned by 'git credential' is invalid, but\n` +
					`could not be removed. Please manually remove the PAT from 'git credential'\n` +
					`for the host 'github.com'`);
			}
			throw new Error(`The PAT returned by 'git credential' is invalid. Python Environment Tool cannot be\n` +
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
				throw new Error(`Failed to download Python Environment Tool: HTTP ${response.statusCode}\n\n` +
					`${responseBody}`);
			}
			const releases = JSON.parse(responseBody);
			if (!Array.isArray(releases)) {
				throw new Error(`Unexpected response from Github:\n\n` +
					`${responseBody}`);
			}
			const release = releases.find((asset: any) => asset.tag_name == version);
			if (!release) {
				throw new Error(`Could not find Python Environment Tool ${version} in the releases.`);
			}
			const zipUrl = release.zipball_url;
			if (!zipUrl) {
				throw new Error(`Could not find Python Environment Tool with asset name ${version} in the release.`);
			}
			console.log(`Downloading Python Environment Tool ${version} from ${zipUrl}...`);
			const url = new URL(zipUrl);
			// Reset the Accept header to download the asset.
			headers.Accept = 'application/json';
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
				const extensionParent = path.dirname(__dirname);
				const petDir = path.join(extensionParent, 'python-env-tools');
				// Create the resources/pet directory if it doesn't exist.
				if (!await existsAsync(petDir)) {
					await fs.promises.mkdir(petDir);
				}

				console.log(`Successfully downloaded PET ${version} (${binaryData.length} bytes).`);
				const zipFileDest = path.join(petDir, 'pet.zip');
				await writeFileAsync(zipFileDest, binaryData);

				await decompress(zipFileDest, petDir, { strip: 1 }).then(files => {
					console.log(`Successfully unzipped Python Environment Tool ${version}.`);
				});

				// Clean up the zipfile.
				await fs.promises.unlink(zipFileDest);

				// Write a VERSION file with the version number.
				await writeFileAsync(path.join('resources', 'pet', 'VERSION'), version);

			});
		});
	} catch (error) {
		throw new Error(`Error downloading Pet: ${error}`);
	}
}

async function main() {
	// Before we do any work, check to see if there is a locally built copy of
	// the Python Environment Tool in the `pet / target` directory. If so, we'll assume
	// that the user is a kernel developer and skip the download; this version
	// will take precedence over any downloaded version.
	const extensionParent = path.dirname(__dirname);
	const petFolder = path.join(extensionParent, 'python-env-tools');
	if (fs.existsSync(petFolder)) {
		console.log(`Using locally built PET in ${petFolder}.`);
		// TODO: need this?
		// Copy the locally built PET to the resources/PET directory. It won't
		// be read from this directory at runtime, but we need to put it here
		// so that `yarn gulp vscode` will package it up (the packaging step
		// doesn't look for a sideloaded PET from an adjacent `pet` directory).
		// fs.mkdirSync(path.join('resources', 'pet'), { recursive: true });
		// fs.copyFileSync(binary, path.join('resources', 'pet', kernelName));
		return;
	} else {
		console.log(`No locally built Python Environment Tool found in ${petFolder}; ` +
			`checking downloaded version.`);
	}

	const packageJsonVersion = await getVersionFromPackageJson();
	const localPetVersion = await getLocalPetVersion();

	if (!packageJsonVersion) {
		throw new Error('Could not determine PET version from package.json.');
	}

	console.log(`package.json version: ${packageJsonVersion} `);
	console.log(`Downloaded PET version: ${localPetVersion ? localPetVersion : 'Not found'} `);

	if (packageJsonVersion === localPetVersion) {
		console.log('Versions match. No action required.');
		return;
	}

	// We need a Github Personal Access Token (PAT) to download PET. Because this is sensitive
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
			}
		} catch (error) {
			// We don't care if this fails; we'll try `git credential` next.
		}
	}

	// (4) If no GITHUB_PAT is set, try to get it from git credential.
	if (!githubPat) {
		// Explain to the user what's about to happen.
		console.log(`Attempting to retrieve a Github Personal Access Token from git in order\n` +
			`to download Python Environment Tool ${packageJsonVersion}. If you are prompted for a username and\n` +
			`password, enter your Github username and a Personal Access Token with the\n` +
			`'repo' scope. You can read about how to create a Personal Access Token here: \n` +
			`\n` +
			`https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens\n` +
			`\n` +
			`If you don't want to set up a Personal Access Token now, just press Enter twice to set \n` +
			`a blank value for the password. Python Environment Tool will not be downloaded, but you will still be\n` +
			`able to run Positron with Python support.\n` +
			`\n` +
			`You can set a PAT later by running yarn again and supplying the PAT at this prompt,\n` +
			`or by running 'git config credential.https://api.github.com.token YOUR_GITHUB_PAT'\n`);
		const { stdout, stderr } =
			await executeCommand('git credential fill',
				`protocol=https\n` +
				`host=github.com\n` +
				`path=/repos/posit-dev/pet/releases\n`);

		gitCredential = true;
		// Extract the `password = ` line from the output.
		const passwordLine = stdout.split('\n').find(
			(line: string) => line.startsWith('password='));
		if (passwordLine) {
			githubPat = passwordLine.split('=')[1];
			console.log(`Using Github PAT returned from 'git credential'.`);
		}
	}

	if (!githubPat) {
		throw new Error(`No Github PAT was found. Unable to download PET ${packageJsonVersion}.\n` +
			`You can still run Positron with Python Support.`);
	}

	await downloadAndReplacePet(packageJsonVersion, githubPat, gitCredential);
}

main().catch((error) => {
	console.error('An error occurred:', error);
});
