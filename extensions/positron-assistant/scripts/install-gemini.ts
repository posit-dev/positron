/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as decompress from 'decompress';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const name = 'gemini-code-assist';
const label = 'Gemini Code Assist';
const installDir = path.join('resources', name);
const versionFile = path.join(installDir, 'VERSION');

// Promisify some filesystem functions.
const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists);

// Create a promisified version of https.get. We can't use the built-in promisify
// because the callback doesn't follow the promise convention of (error, result).
const httpsGetAsync = (opts: https.RequestOptions | string) => {
	return new Promise<IncomingMessage>((resolve, reject) => {
		const req = https.get(opts, resolve);
		req.once('error', reject);
	});
};

/**
 * Gets the version of the Gemini Code Assist extension specified in package.json.
 *
 * @returns The version of the Gemini Code Assist extension specified in package.json,
 * or null if it cannot be determined.
 */
async function getVersionFromPackageJson(): Promise<string | null> {
	try {
		const packageJson = JSON.parse(await fs.promises.readFile('package.json', 'utf-8'));
		return packageJson.positron.binaryDependencies?.['gemini-code-assist'] || null;
	} catch (error) {
		throw new Error(`Error reading package.json ${label} version: ${error}`);
	}
}

/**
 * Gets the version of the Gemini Code Assist extension installed locally by reading a `VERSION` file
 * that's written by this script.
 *
 * @returns The version of the Gemini Code Assist extension installed locally, or null if it is not installed.
 */
async function getLocalVersion(): Promise<string | null> {
	try {
		if (!(await existsAsync(versionFile))) {
			return null;
		}
		return await fs.promises.readFile(versionFile, 'utf-8');
	} catch (error) {
		throw new Error(`Error determining local ${label} version: ${error}`);
	}
}

/**
 * Extracts the language server binary for the current platform and architecture from the specified VSIX file.
 *
 * @param vsixFile The path to the VSIX file to extract the language server from.
 */
async function extractLanguageServer(vsixFile: string): Promise<void> {
	const binaryFile = 'cloudcode_cli';
	const zipFile = `${binaryFile}.zip`;
	const [languageServerZipFile] = await decompress(vsixFile, installDir, {
		// Only extract the language server zip file.
		filter: file => file.path.endsWith(zipFile),
		map: file => {
			// Strip parent dirs from the path i.e. unzip to the install dir.
			file.path = zipFile;
			return file;
		}
	});
	if (!languageServerZipFile?.path) {
		throw new Error(`Failed to extract ${zipFile} from ${vsixFile}`);
	}
	const languageServerZip = path.join(installDir, languageServerZipFile.path);

	// Determine the binary directory for this platform and architecture.
	try {
		const languageServerDir = 'win32' === process.platform
			? 'windows_amd64'
			: 'darwin' === process.platform
				? 'arm64' === os.arch()
					? 'darwin_arm64'
					: 'darwin_amd64'
				: 'arm64' === os.arch()
					? 'linux_arm64'
					: 'linux_amd64';

		const languageServerBinaryFiles = await decompress(languageServerZip, installDir, {
			// Only extract the language server binary file.
			filter: file => file.path === path.join(languageServerDir, binaryFile),
			map: file => {
				// Strip parent dirs from the path i.e. unzip to the install dir.
				file.path = binaryFile;
				return file;
			},
		});
		if (languageServerBinaryFiles.length === 0) {
			throw new Error(`Failed to extract ${binaryFile} from ${languageServerZip}`);
		}
	} finally {
		// Clean up the language server zip.
		await fs.promises.unlink(languageServerZip);
	}
}

/**
 * Downloads the specified version of the Gemini Code Assist extension and extracts the language
 * server binary for the current platform.
 *
 * @param version The version of the Gemini Code Assist extension to download.
 */
async function downloadAndReplace(version: string): Promise<void> {
	try {
		const headers: Record<string, string> = {
			'Accept': 'application/json',
			'User-Agent': 'positron-assistant-downloader'
		};
		const requestOptions: https.RequestOptions = {
			headers,
			method: 'GET',
			protocol: 'https:',
			hostname: 'open-vsx.org',
			path: `/api/google/geminicodeassist/${version}`,
		};

		const response = await httpsGetAsync(requestOptions);

		let responseBody = '';
		response.on('data', (chunk: string) => {
			responseBody += chunk;
		});

		response.on('end', async () => {
			if (response.statusCode !== 200) {
				throw new Error(`Failed to download ${label}: HTTP ${response.statusCode}\n\n` +
					`${responseBody}`);
			}
			const data = JSON.parse(responseBody);
			if (!data?.files?.download) {
				throw new Error(`Failed to find download URL in response: ${data}`);
			}
			console.log(`Downloading ${label} ${version} from ${data.files.download}...`);

			// Reset the Accept header to download the asset.
			headers.Accept = 'application/octet-stream';

			const url = new URL(data.files.download);
			const requestOptions: https.RequestOptions = {
				headers,
				method: 'GET',
				protocol: url.protocol,
				hostname: url.hostname,
				path: url.pathname
			};

			let dlResponse = await httpsGetAsync(requestOptions);
			while (dlResponse.statusCode === 302 && dlResponse.headers.location) {
				// Follow redirects.
				dlResponse = await httpsGetAsync(dlResponse.headers.location);
			}

			let binaryData = Buffer.alloc(0);
			dlResponse.on('data', (chunk: any) => {
				binaryData = Buffer.concat([binaryData, chunk]);
			});

			dlResponse.on('end', async () => {
				// Create the install directory if it doesn't exist.
				if (!await existsAsync(installDir)) {
					await fs.promises.mkdir(installDir);
				}

				console.log(`Successfully downloaded ${label} ${version} (${binaryData.length} bytes).`);
				const vsixFile = path.join(installDir, 'gemini-code-assist.vsix');
				await writeFileAsync(vsixFile, binaryData);

				try {
					await extractLanguageServer(vsixFile);
					console.log(`Successfully unzipped ${label} ${version} language server.`);
				} finally {
					// Clean up the VSIX file.
					await fs.promises.unlink(vsixFile);
				}

				// Write a VERSION file with the version number.
				await writeFileAsync(versionFile, version);

			});
		});
	} catch (error) {
		throw new Error(`Error downloading ${label}: ${error}`);
	}
}

async function main(): Promise<void> {
	console.log('Installing Gemini Code Assist language server...');

	const packageJsonVersion = await getVersionFromPackageJson();
	if (!packageJsonVersion) {
		throw new Error('Could not determine Gemini Code Assist version from package.json.');
	}

	const localVersion = await getLocalVersion();

	console.log(`Required: ${packageJsonVersion} `);
	console.log(`Existing: ${localVersion ?? 'None'} `);

	if (localVersion === packageJsonVersion) {
		console.log('Requirement already satisfied.');
		return;
	}

	await downloadAndReplace(packageJsonVersion);
}

main().catch(error => {
	console.error('An error occurred:', error);
});
