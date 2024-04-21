/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
// TODO: Can we use webpack? Why did they use esbuild for webview contents?

// @ts-check
const path = require('path');

const srcDir = path.join(__dirname, 'webview/src');
const outDir = path.join(__dirname, 'media');

require('../esbuild-webview-common').run({
	entryPoints: {
		'index': path.join(srcDir, 'index.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		loader: {
			// TODO: This ends up being a 5.1 MB file. Do we need all of this??
			//  Is it perhaps included via something else?
			// TODO: Or 'text'?
			'.svg': 'dataurl',
			'.ttf': 'dataurl',
			'.woff': 'dataurl',
			'.woff2': 'dataurl',
			'.eot': 'dataurl',
		}
	}
}, process.argv);
