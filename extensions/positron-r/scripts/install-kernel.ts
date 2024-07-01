/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as decompress from 'decompress';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import { platform } from 'os';
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
		console.error('Error determining ARK version: ', error);
		return null;
	}
}

/**
 * Downloads the specified version of Ark and replaces the local binary.
 *
 * @param version The version of Ark to download.
 */
async function downloadAndReplaceArk(version: string): Promise<void> {

	try {
		const requestOptions: https.RequestOptions = {
			headers: {
				'Accept': 'application/vnd.github.v3.raw', // eslint-disable-line
				'User-Agent': 'positron-ark-downloader'    // eslint-disable-line
			},
			method: 'GET',
			protocol: 'https:',
			hostname: 'api.github.com',
			path: `/repos/posit-dev/ark/releases`
		};

		const response = await httpsGetAsync(requestOptions as any) as any;
		let responseBody = '';

		response.on('data', (chunk: any) => {
			responseBody += chunk;
		});

		response.on('end', async () => {
			if (response.statusCode !== 200) {
				throw new Error(`Failed to download Ark: HTTP ${response.statusCode}\n\n` +
					`${responseBody}`);
			}
			const releases = JSON.parse(responseBody);
			if (!Array.isArray(releases)) {
				throw new Error(`Unexpected response from Github:\n\n` +
					`${responseBody}`);
			}
			const release = releases.find((asset: any) => asset.tag_name === version);
			if (!release) {
				console.error(`Could not find Ark ${version} in the releases.`);
				return;
			}

			let os: string;
			switch (platform()) {
				case 'win32': os = 'windows-x64'; break;
				case 'darwin': os = 'darwin-universal'; break;
				case 'linux': os = 'linux-x64'; break;
				default: {
					console.error(`Unsupported platform ${platform()}.`);
					return;
				}
			}

			const assetName = `ark-${version}-${os}.zip`;
			const asset = release.assets.find((asset: any) => asset.name === assetName);
			if (!asset) {
				console.error(`Could not find Ark with asset name ${assetName} in the release.`);
				return;
			}
			console.log(`Downloading Ark ${version} from ${asset.url}...`);
			const url = new URL(asset.url);
			const requestOptions: https.RequestOptions = {
				headers: {
					'Accept': 'application/octet-stream',    // eslint-disable-line
					'User-Agent': 'positron-ark-downloader'  // eslint-disable-line
				},
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
				const arkDir = path.join('resources', 'ark');

				// Create the resources/ark directory if it doesn't exist.
				if (!await existsAsync(arkDir)) {
					await fs.promises.mkdir(arkDir);
				}

				console.log(`Successfully downloaded Ark ${version} (${binaryData.length} bytes).`);
				const zipFileDest = path.join(arkDir, 'ark.zip');
				await writeFileAsync(zipFileDest, binaryData);

				await decompress(zipFileDest, arkDir).then(files => {
					console.log(`Successfully unzipped Ark ${version}.`);
				});

				// Clean up the zipfile.
				await fs.promises.unlink(zipFileDest);

				// Write a VERSION file with the version number.
				await writeFileAsync(path.join('resources', 'ark', 'VERSION'), version);

			});
		});
	} catch (error) {
		console.error('Error downloading Ark:', error);
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
		console.error('Could not determine Ark version from package.json.');
		return;
	}

	console.log(`package.json version: ${packageJsonVersion} `);
	console.log(`Downloaded ark version: ${localArkVersion ? localArkVersion : 'Not found'} `);

	if (packageJsonVersion === localArkVersion) {
		console.log('Versions match. No action required.');
		return;
	}

	await downloadAndReplaceArk(packageJsonVersion);
}

main().catch((error) => {
	console.error('An error occurred:', error);
});
