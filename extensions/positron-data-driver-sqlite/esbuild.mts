/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist');

run({
	platform: 'node',
	entryPoints: {
		'extension': path.join(srcDir, 'extension.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// better-sqlite3 is a native module; externalize so it's loaded from
		// node_modules at runtime (positron-data-driver-sqlite is registered in
		// extensionsWithNpmDeps so its dependencies are packaged).
		external: ['vscode', 'positron', 'better-sqlite3'],
	},
}, process.argv);
