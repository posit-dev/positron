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
		// The ADBC driver manager and the third-party driver shared library it loads
		// run in this child process (forked by adbcWorkerClient.ts) so a fault in an
		// arbitrary vendor driver cannot take down the extension host. It is emitted
		// next to extension.js and located at runtime via __dirname.
		'adbcWorker': path.join(srcDir, 'adbcWorker.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// @apache-arrow/adbc-driver-manager loads a native N-API addon and is
		// ESM-only; externalize so it's loaded from node_modules at runtime via a
		// dynamic import (positron-data-driver-adbc is registered in
		// extensionsWithNpmDeps so its dependencies are packaged). Like the DuckDB
		// binding, the N-API addon is ABI-stable across Node and Electron, so no
		// electron-rebuild is required and this extension needs no .npmrc to inherit
		// the root electron build config. Only adbcWorker.ts imports these; the
		// extension host bundle never loads the native binding.
		external: ['vscode', 'positron', '@apache-arrow/adbc-driver-manager', 'apache-arrow'],
	},
}, process.argv);
