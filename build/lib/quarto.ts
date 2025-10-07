/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import fancyLog from 'fancy-log';
import { fetchUrls } from './fetch';
import * as es from 'event-stream';
import { Stream } from 'stream';
import gulp = require('gulp');
import util = require('./util');
import rename = require('gulp-rename');
import path = require('path');

/**
 * Get the base URL for the quarto download
 *
 * @param version The version of quarto to download
 * @returns The base URL for the quarto download
 */
function getBaseUrl(version: string): string {
	return `https://github.com/quarto-dev/quarto-cli/releases/download/v${version}/`;
}

/**
 * Gets a stream that downloads and unpacks the quarto executable for Windows
 *
 * @param version The version of quarto to download
 * @returns A stream
 */
function getQuartoWindows(version: string): Stream {
	const unzip = require('gulp-unzip');
	const basename = `quarto-${version}-win`;
	return fetchUrls([`${basename}.zip`], {
		base: getBaseUrl(version),
		verbose: true,
		timeoutSeconds: 90,
	})
		.pipe(unzip({ keepEmpty: true }));
}

/**
 * Gets a stream that downloads and unpacks the quarto executable for macOS
 *
 * @param version The version of quarto to download
 * @returns A stream
 */
function getQuartoMacOS(version: string): Stream {
	const gunzip = require('gulp-gunzip');
	const untar = require('gulp-untar');

	return fetchUrls([`quarto-${version}-macos.tar.gz`], {
		base: getBaseUrl(version),
		verbose: true,
		timeoutSeconds: 90,
	})
		// Unzip, then untar
		.pipe(gunzip())
		.pipe(untar());
}

/**
 * Gets a stream that downloads and unpacks the quarto executable for Linux
 *
 * @param version The version of quarto to download
 * @returns A stream
 */
function getQuartoLinux(version: string): Stream {
	const gunzip = require('gulp-gunzip');
	const untar = require('gulp-untar');
	const rename = require('gulp-rename');

	const basename = process.env['npm_config_arch'] === 'x64' ?
		`quarto-${version}-linux-amd64` :
		`quarto-${version}-linux-arm64`;

	return fetchUrls([`${basename}.tar.gz`], {
		base: getBaseUrl(version),
		verbose: true,
		timeoutSeconds: 90,
	})
		// Unzip, then untar
		.pipe(gunzip())
		.pipe(untar())
		// Remove the leading directory from the path
		.pipe(rename((path: any) => {
			if (path.dirname.startsWith(`quarto-${version}`)) {
				path.dirname = path.dirname.replace(/^quarto-[^/]+\/?/, '');
			}
		}));
}

/**
 * Gets a stream that downloads and unpacks the quarto executable. Reads
 * `npm_config_arch` to determine the architecture.
 *
 * @returns A stream that downloads and unpacks the quarto executable
 */
export function getQuartoStream(): Stream {
	// quarto version
	const version = '1.7.32';

	fancyLog(`Synchronizing quarto ${version}...`);

	// Get the download/unpack stream for the current platform
	return process.platform === 'win32' ?
		getQuartoWindows(version) :
		process.platform === 'darwin' ?
			getQuartoMacOS(version) :
			getQuartoLinux(version);
}

/**
 * Standalone helper for downloading and unpacking quarto; downloads quarto to
 * thie `.build` folder for testing.
 *
 * @returns A promise that resolves when quarto is downloaded and unpacked
 */
export function getQuarto(): Promise<void> {
	const stream = getQuartoStream()
		.pipe(util.setExecutableBit())
		.pipe(gulp.dest('.build/quarto'));

	return new Promise((resolve, reject) => {
		es.merge([stream])
			.on('error', reject)
			.on('end', resolve);
	});
}

/**
 * Helper to package the quarto binaries into a `quarto` subdirectory with
 * the executable bit set.
 *
 * @returns A stream that provides the quarto binaries
 */
export function getQuartoBinaries(): Stream {
	return getQuartoStream()
		// Move the Quarto binaries into a `quarto` subdirectory
		.pipe(rename(f => { f.dirname = path.join('quarto', f.dirname || ''); }))

		// Skip generated files that start with '._'
		.pipe(es.mapSync((f: any) => {
			if (!f.basename.startsWith('._')) {
				return f;
			}
		}))

		// Restore the executable bit on the Quarto binaries. (It's very
		// unfortunate that gulp doesn't preserve the executable bit when
		// copying files.)
		.pipe(util.setExecutableBit([
			'**/dart',
			'**/deno',
			'**/esbuild',
			'**/pandoc',
			'**/quarto',
			'**/sass',
			'**/typst'
		]));
}

if (require.main === module) {
	getQuarto().then(() => process.exit(0)).catch(err => {
		console.error(err);
		process.exit(1);
	});
}
