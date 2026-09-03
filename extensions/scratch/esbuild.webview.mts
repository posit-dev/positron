/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'webview-src');
const outDir = path.join(import.meta.dirname, 'dist');

// `dist` rather than the usual `media`: it is already covered by the repo
// .gitignore, and scratch's bundle is a build artifact nobody should commit.
//
// One entry point emits both files. The CSS is imported from providerDemo.tsx,
// which esbuild collects into a sibling dist/providerDemo.css.
run({
	entryPoints: {
		'providerDemo': path.join(srcDir, 'providerDemo.tsx'),
	},
	srcDir,
	outdir: outDir,
}, process.argv);
