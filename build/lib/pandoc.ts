/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fancyLog from 'fancy-log';
import { fetchUrls } from './fetch';
import * as es from 'event-stream';
import { Stream } from 'stream';
import filter = require('gulp-filter');

function getBaseUrl(version: string): string {
	return `https://github.com/jgm/pandoc/releases/download/${version}/`;
}

function getPandocWindows(version: string): Stream {
	const unzip = require('gulp-unzip');
	const basename = `pandoc-${version}-windows-x86_64`;
	const rename = require('gulp-rename');
	return fetchUrls([`${basename}.zip`], {
		base: getBaseUrl(version),
		verbose: true,
	})
		.pipe(unzip({
			filter: (entry: any) => entry.path.endsWith('.exe')
		}))
		.pipe(rename(`pandoc.exe`));
}

function getPandocMacOS(version: string): Stream {
	const unzip = require('gulp-unzip');
	const rename = require('gulp-rename');

	const basename = process.env['npm_config_arch'] === 'x64' ?
		`pandoc-${version}-x86_64-macOS` :
		`pandoc-${version}-arm64-macOS`;

	return fetchUrls([`${basename}.zip`], {
		base: getBaseUrl(version),
		verbose: true,
	})
		.pipe(unzip({
			filter: (entry: any) => entry.path.endsWith('pandoc')
		}))
		.pipe(rename(`pandoc`));
}

function getPandocLinux(version: string): Stream {
	const gunzip = require('gulp-gunzip');
	const untar = require('gulp-untar');
	const flatmap = require('gulp-flatmap');
	const rename = require('gulp-rename');

	const basename = process.env['npm_config_arch'] === 'x64' ?
		`pandoc-${version}-linux-amd64` :
		`pandoc-${version}-linux-arm64`;

	return fetchUrls([`${basename}.tar.gz`], {
		base: getBaseUrl(version),
		verbose: true,
	})
		.pipe(flatmap((stream: Stream) => stream.pipe(gunzip()).pipe(untar())))
		.pipe(filter('**/pandoc'))
		.pipe(rename(`pandoc`));
}

export function getPandocStream(): Stream {
	const version = '3.1.12.3';
	fancyLog(`Synchronizing Pandoc ${version}...`);
	// Get the download/unpack stream for the current platform
	return process.platform === 'win32' ?
		getPandocWindows(version) :
		process.platform === 'darwin' ?
			getPandocMacOS(version) :
			getPandocLinux(version);
}

export function getPandoc(): Promise<void> {
	const stream = getPandocStream();

	return new Promise((resolve, reject) => {
		es.merge([stream])
			.on('error', reject)
			.on('end', resolve);
	});
}

if (require.main === module) {
	getPandoc().then(() => process.exit(0)).catch(err => {
		console.error(err);
		process.exit(1);
	});
}
