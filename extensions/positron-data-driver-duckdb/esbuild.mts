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
		// The DuckDB native instance runs in this child process (forked by
		// duckdbWorkerClient.ts) so a native abort cannot take down the extension
		// host. It is emitted next to extension.js and located at runtime via
		// __dirname.
		'duckdbWorker': path.join(srcDir, 'duckdbWorker.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// @duckdb/node-api loads a native N-API addon (@duckdb/node-bindings) plus a
		// prebuilt libduckdb; externalize so it's loaded from node_modules at runtime
		// (positron-data-driver-duckdb is registered in extensionsWithNpmDeps so its
		// dependencies are packaged). Unlike better-sqlite3, the N-API binding is
		// ABI-stable across Node and Electron, so no electron-rebuild is required and
		// this extension does not need an .npmrc to inherit the root electron build config.
		// Only duckdbWorker.ts imports these; the extension host bundle never loads
		// the native binding.
		external: ['vscode', 'positron', '@duckdb/node-api', '@duckdb/node-bindings'],
	},
}, process.argv);
