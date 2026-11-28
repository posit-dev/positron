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
 * as a zip file and extracted to the extension's pdfjs-dist directory. This directory is
 * .gitignored so that we don't accidentally commit the large viewer files to the repository.
 *
 * The zip is extracted in Node with yauzl rather than with a platform tool. PowerShell's
 * Expand-Archive failed on the Windows arm64 build runners (it loaded the PowerShell 7
 * archive module into Windows PowerShell) without failing the script, so those builds
 * shipped the extension without the viewer.
 *
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import * as yauzl from 'yauzl';

// Determine paths.
const scriptDir = __dirname;
const extensionDir = path.dirname(scriptDir);
const targetDir = path.join(extensionDir, 'pdfjs-dist');
const tempZip = path.join(extensionDir, 'pdfjs-temp.zip');

/**
 * Written into `targetDir` after a complete, verified extraction, holding the
 * PDF.js version. A viewer without it (an interrupted run) or with another
 * version (pdfjs-dist was bumped) is downloaded again.
 */
const versionMarker = path.join(targetDir, '.pdfjs-version');

/** Retries for removals that a scanner holding a file open can fail on Windows. */
const rmOptions: fs.RmOptions = { recursive: true, force: true, maxRetries: 5 };

/**
 * A few files the viewer cannot start without. A missing one means the
 * archive layout changed or extraction failed, so the install fails.
 */
const requiredFiles = [
	'web/viewer.html',
	'web/viewer.mjs',
	'web/viewer.css',
	'build/pdf.mjs',
	'build/pdf.worker.mjs',
];

/**
 * Download `url` to `dest`, following redirects. Throws on a non-2xx response.
 */
async function downloadFile(url: string, dest: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok || !response.body) {
		throw new Error(`Download of ${url} failed: HTTP ${response.status} ${response.statusText}`);
	}
	await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fs.createWriteStream(dest));
}

/**
 * Extract every entry of a zip file into `destDir` and return the number of
 * files written. yauzl rejects entries with absolute paths or `..` segments.
 */
async function extractZip(zipPath: string, destDir: string): Promise<number> {
	const zipfile = await promisify<string, yauzl.Options, yauzl.ZipFile>(yauzl.open)(zipPath, { lazyEntries: true });
	const openReadStream = promisify((entry: yauzl.Entry, callback: (err: Error | null, stream: Readable) => void) => zipfile.openReadStream(entry, callback));
	let fileCount = 0;
	await new Promise<void>((resolve, reject) => {
		zipfile.on('error', reject);
		zipfile.on('end', () => resolve());
		zipfile.on('entry', async (entry: yauzl.Entry) => {
			try {
				const dest = path.join(destDir, entry.fileName);
				if (entry.fileName.endsWith('/')) {
					await fs.promises.mkdir(dest, { recursive: true });
				} else {
					await fs.promises.mkdir(path.dirname(dest), { recursive: true });
					await pipeline(await openReadStream(entry), fs.createWriteStream(dest));
					fileCount++;
				}
				zipfile.readEntry();
			} catch (err) {
				zipfile.close();
				reject(err);
			}
		});
		zipfile.readEntry();
	});
	return fileCount;
}

/**
 * Throw if any required viewer file is missing from `dir`.
 */
function verifyViewer(dir: string): void {
	const missing = requiredFiles.filter(file => !fs.existsSync(path.join(dir, file)));
	if (missing.length > 0) {
		throw new Error(`PDF.js viewer is incomplete; missing ${missing.join(', ')} in ${dir}`);
	}
}

/**
 * True if `targetDir` holds a complete viewer of `version` from an earlier run.
 */
function isViewerCurrent(version: string): boolean {
	try {
		if (fs.readFileSync(versionMarker, 'utf8').trim() !== version) {
			return false;
		}
		verifyViewer(targetDir);
		return true;
	} catch {
		return false;
	}
}

/**
 * Remove `target` without letting a cleanup failure hide the error that led to it.
 */
async function removeBestEffort(target: string): Promise<void> {
	try {
		await fs.promises.rm(target, rmOptions);
	} catch (err) {
		console.warn(`Could not remove ${target}:`, err);
	}
}

async function main(): Promise<void> {
	// Read version from package.json so we stay in sync with the installed version of pdfjs-dist.
	const packageJsonPath = path.join(extensionDir, 'package.json');
	const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
	const version = packageData.devDependencies['pdfjs-dist'].replace(/[^0-9.]/g, '');

	if (isViewerCurrent(version)) {
		console.log(`PDF.js v${version} viewer has already been downloaded. Skipping download.`);
		return;
	}

	// Download and extract (legacy dist for Electron compatibility).
	const url = `https://github.com/mozilla/pdf.js/releases/download/v${version}/pdfjs-${version}-legacy-dist.zip`;
	console.log(`Downloading PDF.js v${version} legacy viewer...`);

	try {
		// Download before touching targetDir, so a failed download leaves an
		// existing viewer in place.
		await downloadFile(url, tempZip);

		try {
			// Start from an empty directory, so no file from another version or an
			// interrupted run survives. The version marker goes in last.
			await fs.promises.rm(targetDir, rmOptions);
			const fileCount = await extractZip(tempZip, targetDir);
			verifyViewer(targetDir);
			await fs.promises.writeFile(versionMarker, version);
			console.log(`PDF.js viewer downloaded successfully to ${targetDir} (${fileCount} files)`);
		} catch (err) {
			// Don't leave a partial viewer behind for packaging to pick up.
			await removeBestEffort(targetDir);
			throw err;
		}
	} finally {
		await removeBestEffort(tempZip);
	}
}

main().catch(err => {
	console.error('Error downloading PDF.js viewer:', err);
	process.exit(1);
});
