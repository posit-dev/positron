/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fancyLog from 'fancy-log';
import { fetchUrls } from './fetch';
import * as es from 'event-stream';
import gulp = require('gulp');
import { Stream } from 'stream';


export function getPandoc(): Promise<void> {
	// Unzip util for MacOS and Windows
	const unzip = require('gulp-unzip');

	// Gunzip and untar util for Linux
	const gunzip = require('gulp-gunzip');
	const untar = require('gulp-untar');
	const flatmap = require('gulp-flatmap');

	const version = '3.1.12.3';
	fancyLog(`Synchronizing Pandoc ${version}...`);
	const base = `https://github.com/jgm/pandoc/releases/download/${version}/`;

	let filename = '';
	if (process.platform === 'darwin') {
		if (process.arch === 'x64') {
			filename = `pandoc-${version}-x86_64-macOS.zip`;
		} else {
			filename = `pandoc-${version}-arm64-macOS.zip`;
		}
	} else if (process.platform === 'linux') {
		if (process.arch === 'x64') {
			filename = `pandoc-${version}-linux-amd64.tar.gz`;
		} else {
			filename = `pandoc-${version}-linux-arm64.tar.gz`;
		}
	} else if (process.platform === 'win32') {
		filename = `pandoc-${version}-windows-x86_64.zip`;
	}

	const stream = fetchUrls([filename], {
		base,
		verbose: true,
	})
		.pipe(filename.endsWith('zip') ?
			unzip() :
			flatmap((stream: Stream) => stream.pipe(gunzip()).pipe(untar())))
		.pipe(gulp.dest('.build/pandoc'));

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
