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
		// The DuckDB native instance that backs the Data Explorer preview runs in this child process
		// (forked by the shared DuckDBWorkerClient) so a native abort cannot take down the extension
		// host. It re-exports the worker from positron-data-explorer-duckdb; esbuild bundles it next
		// to extension.js so the runtime __dirname lookup resolves.
		'duckdbWorker': path.join(srcDir, 'duckdbWorker.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// @duckdb/node-api loads a native N-API addon (@duckdb/node-bindings) plus a prebuilt
		// libduckdb; externalize so it's loaded from node_modules at runtime (this extension is
		// registered in extensionsWithNpmDeps so its dependencies are packaged). Only duckdbWorker.ts
		// imports these; the extension host bundle never loads the native binding.
		external: ['vscode', 'positron', '@duckdb/node-api', '@duckdb/node-bindings'],
	},
}, process.argv);
