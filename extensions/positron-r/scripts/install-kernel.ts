/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import { promisify } from 'util';

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists);
const httpsGetAsync = (opts: https.RequestOptions) => {
	return new Promise<IncomingMessage>((resolve, reject) => {
		const req = https.get(opts, resolve);
		req.once('error', reject);
	});
};

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
		console.error('Error reading package.json: ', error);
		return null;
	}
}

/**
 * Gets the version of Ark installed locally.
 *
 * @returns The version of Ark installed locally, or null if ark is not installed.
 */
async function getLocalArkVersion(): Promise<string | null> {
	try {
		const arkExists = await existsAsync('resources/ark/VERSION');
		if (!arkExists) {
			return null;
		}
		return readFileAsync('resources/ark/VERSION', 'utf-8');
	} catch (error) {
		console.error('Error determining ARK version":', error);
		return null;
	}
}

/**
 * Helper to execute a command and return the stdout and stderr.
 *
 * @param command The command to execute.
 * @returns A promise that resolves with the stdout and stderr of the command.
 */
async function executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
	const { exec } = require('child_process');
	return new Promise((resolve, reject) => {
		exec(command, (error: any, stdout: string, stderr: string) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

/**
 * Downloads the specified version of Ark and replaces the local binary.
 *
 * @param version The version of Ark to download.
 * @param githubPat A Github Personal Access Token with the appropriate rights
 *  to download the release.
 */
async function downloadAndReplaceArk(version: string, githubPat: string): Promise<void> {

	try {
		const requestOptions: https.RequestOptions = {
			headers: {
				'Accept': 'application/vnd.github.v3.raw', // eslint-disable-line
				'Authorization': `token ${githubPat}`,     // eslint-disable-line
				'User-Agent': 'positron-ark-downloader'    // eslint-disable-line
			},
			method: 'GET',
			protocol: 'https:',
			hostname: 'api.github.com',
			path: `/repos/posit-dev/amalthea/releases`
		};

		const response = await httpsGetAsync(requestOptions as any) as any;

		let responseBody = '';

		response.on('data', (chunk: any) => {
			responseBody += chunk;
		});

		response.on('end', async () => {
			const releases = JSON.parse(responseBody);
			const release = releases.find((asset: any) => asset.tag_name === version);
			if (!release) {
				console.error(`Could not find Ark ${version} in the releases.`);
				return;
			}
			// For now, assume that the first asset is the one we want.
			const asset = release.assets[0];
			console.log(`Downloading Ark ${version} from ${asset.url}...`);
			const url = new URL(asset.url);
			const requestOptions: https.RequestOptions = {
				headers: {
					'Accept': 'application/octet-stream',    // eslint-disable-line
					'Authorization': `token ${githubPat}`,   // eslint-disable-line
					'User-Agent': 'positron-ark-downloader'  // eslint-disable-line
				},
				method: 'GET',
				protocol: url.protocol,
				hostname: url.hostname,
				path: url.pathname
			};

			let response = await httpsGetAsync(requestOptions) as any;
			while (response.statusCode === 302) {
				response = await httpsGetAsync(response.headers.location) as any;
			}
			let binaryData = Buffer.alloc(0);

			response.on('data', (chunk: any) => {
				binaryData = Buffer.concat([binaryData, chunk]);
			});
			response.on('end', async () => {
				// Create the resources/ark directory if it doesn't exist.
				if (!await existsAsync('resources/bin')) {
					await fs.promises.mkdir('resources/bin');
				}

				console.log(`Successfully downloaded Ark ${version} (${binaryData.length} bytes).`);
				await writeFileAsync('resources/ark/ark.zip', binaryData);

				// Unzip the binary.
				const { stdout, stderr } =
					await executeCommand('unzip -o resources/ark/ark.zip -d resources/ark');
				console.log(stdout);
				if (stderr) {
					console.error(stderr);
				} else {
					console.log(`Successfully unzipped Ark ${version}.`);
				}

				// Write a VERSION file with the version number.
				await writeFileAsync('resources/ark/VERSION', version);

			});
		});
	} catch (error) {
		console.error('Error downloading Ark:', error);
	}
}

async function main() {
	const packageJsonVersion = await getVersionFromPackageJson();
	const localArkVersion = await getLocalArkVersion();

	if (!packageJsonVersion) {
		console.error('Could not determine Ark version from package.json.');
		return;
	}

	console.log(`package.json version: ${packageJsonVersion}`);
	console.log(`Local ark version: ${localArkVersion ? localArkVersion : 'Not installed'}`);

	if (packageJsonVersion !== localArkVersion) {
		console.log('Versions do not match.');

		// Get the GITHUB_PAT from the environment.
		const githubPat = process.env.GITHUB_PAT;
		if (!githubPat) {
			console.error('GITHUB_PAT environment variable not set; cannot download ark.');
			return;
		}
		await downloadAndReplaceArk(packageJsonVersion, githubPat);
	} else {
		console.log('Versions match. No action required.');
	}
}

main().catch((error) => {
	console.error('An error occurred:', error);
});
