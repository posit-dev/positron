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
		.pipe(unzip());
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
	const filter = require('gulp-filter');

	const arch = process.env['npm_config_arch'];

	// Create a filter to exclude files based on architecture.
	const archFilter = filter((file: any) => {
		const path = file.relative || file.path || '';
		if (arch === 'x64') {
			// For x64, exclude aarch64 files
			return !path.includes('/aarch64/');
		} else {
			// For other architectures (including arm64), exclude x86_64 files
			return !path.includes('/x86_64/');
		}
	});

	return fetchUrls([`quarto-${version}-macos.tar.gz`], {
		base: getBaseUrl(version),
		verbose: true,
		timeoutSeconds: 90,
	})
		// Unzip, then untar
		.pipe(gunzip())
		.pipe(untar())
		// Filter out unnecessary architecture files
		.pipe(archFilter);
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

if (require.main === module) {
	getQuarto().then(() => process.exit(0)).catch(err => {
		console.error(err);
		process.exit(1);
	});
}
