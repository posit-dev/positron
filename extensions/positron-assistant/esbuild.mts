/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { run } from '../esbuild-extension-common.mts';

const require = createRequire(import.meta.url);
const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist');

run({
	platform: 'node',
	entryPoints: {
		'extension': path.join(srcDir, 'extension.ts'),
	},
	srcDir,
	outdir: outDir,
}, process.argv, async (bundleOutDir) => {
	// The resvg wasm binary is loaded at runtime (see tools/svgRasterizer.ts)
	// and must ship next to the bundle, since packaged built-in extensions do
	// not include node_modules.
	await fs.copyFile(
		require.resolve('@resvg/resvg-wasm/index_bg.wasm'),
		path.join(bundleOutDir, 'index_bg.wasm')
	);
});
