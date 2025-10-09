/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const outDir = path.join(__dirname, 'media');

require('../../esbuild-webview-common.mjs').run({
	entryPoints: [
		path.join(srcDir, 'index.ts'),
	],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// Required to bundle fontawesome fonts.
		loader: {
			'.svg': 'dataurl',
			'.ttf': 'dataurl',
			'.woff': 'dataurl',
			'.woff2': 'dataurl',
			'.eot': 'dataurl',
		},
		define: {
			// RequireJS is included by a previous notebook preload script. Some of our dependencies
			// (e.g. backbone) try to use RequireJS's `define` if it's present, but esbuild expects
			// these modules to behave like CommonJS modules. Override the global `define` to
			// undefined to disable this behavior.
			'define': 'undefined',
		},
	},
}, process.argv);
