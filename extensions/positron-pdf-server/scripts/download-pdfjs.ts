/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *
 * This script downloads the PDF.js viewer from GitHub releases.
 *
 * IMPORTANT: The pdfjs-dist npm package (in node_modules) only contains library files
 * (pdf.mjs, pdf_viewer.mjs, etc.) - it does NOT include the full viewer application
 * (viewer.html, viewer.css, locale files, etc.). The complete viewer must be downloaded
 * separately from GitHub releases, which is what this script does. The viewer is downloaded
 * as a zip file, extracted, and the relevant files are copied to the extension's pdfjs-dist
 * directory. This directory is .gitignored so that we don't accidentally commit the large
 * viewer files to the repository.
 *
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execSync } from 'child_process';

// Determine paths.
const scriptDir = __dirname;
const extensionDir = path.dirname(scriptDir);
const targetDir = path.join(extensionDir, 'pdfjs-dist');
const viewerHtml = path.join(targetDir, 'web', 'viewer.html');

// Check if the PDF.js viewer is already downloaded.
if (fs.existsSync(viewerHtml)) {
	console.log('PDF.js viewer has already been downloaded. Skipping download.');
	process.exit(0);
}

// Read version from package.json so we stay in sync with the installed version of pdfjs-dist.
const packageJsonPath = path.join(extensionDir, 'package.json');
const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageData.dependencies['pdfjs-dist'].replace(/[^0-9.]/g, '');

// Log the version being downloaded for clarity.
console.log(`Downloading PDF.js v${version} legacy viewer...`);

// Download and extract (legacy dist for Electron compatibility).
const url = `https://github.com/mozilla/pdf.js/releases/download/v${version}/pdfjs-${version}-legacy-dist.zip`;
const tempZip = path.join(extensionDir, 'pdfjs-temp.zip');

// Download the zip file.
async function downloadFile(): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(tempZip);

		const handleResponse = (response: any) => {
			response.pipe(file);
			file.on('finish', () => {
				file.close((err) => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
			file.on('error', (err) => {
				fs.unlinkSync(tempZip);
				reject(err);
			});
		};

		https.get(url, (response) => {
			if (response.statusCode === 302 || response.statusCode === 301) {
				// Follow redirect
				https.get(response.headers.location!, handleResponse).on('error', (err) => {
					fs.unlinkSync(tempZip);
					reject(err);
				});
			} else {
				handleResponse(response);
			}
		}).on('error', (err) => {
			fs.unlinkSync(tempZip);
			reject(err);
		});
	});
}

// Download and then extract
downloadFile()
	.then(() => extractAndCleanup())
	.catch((err) => {
		console.error('Error downloading PDF.js viewer:', err);
		process.exit(1);
	});

function extractAndCleanup() {
	// Extract the zip file using platform-specific commands.
	// On Windows, use PowerShell's Expand-Archive; on Unix, use unzip.
	try {
		if (process.platform === 'win32') {
			execSync(`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${targetDir}' -Force"`, {
				stdio: 'inherit'
			});
		} else {
			// Ensure target directory exists
			if (!fs.existsSync(targetDir)) {
				fs.mkdirSync(targetDir, { recursive: true });
			}
			execSync(`unzip -q "${tempZip}" -d "${targetDir}"`, {
				stdio: 'inherit'
			});
		}

		// Remove the temporary zip file.
		fs.unlinkSync(tempZip);

		// Log success message.
		console.log(`PDF.js viewer downloaded successfully to ${targetDir}`);
	} catch (error) {
		// Clean up on error
		if (fs.existsSync(tempZip)) {
			fs.unlinkSync(tempZip);
		}
		throw error;
	}
}
