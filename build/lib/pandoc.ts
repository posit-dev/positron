/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fancyLog from 'fancy-log';
import { fetchUrls } from './fetch';
import * as es from 'event-stream';
import gulp = require('gulp');


export function getPandoc(): Promise<void> {
	const unzip = require('gulp-unzip');

	const version = '3.1.12.3';
	fancyLog(`Synchronizing Pandoc ${version}...`);
	const base = `https://github.com/jgm/pandoc/releases/download/${version}/`;
	const filename = `pandoc-${version}-arm64-macOS.zip`;
	const stream = fetchUrls([filename], {
		base,
		verbose: true,
	})
		.pipe(unzip())
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
