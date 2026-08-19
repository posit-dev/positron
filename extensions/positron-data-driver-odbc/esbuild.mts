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
		// The ODBC connection runs in this child process (forked by odbcWorkerClient.ts) so a fault
		// in a third-party vendor driver cannot take down the extension host. It is emitted next to
		// extension.js and located at runtime via __dirname.
		'odbcWorker': path.join(srcDir, 'odbcWorker.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// odbc is a native module; externalize so it's loaded from node_modules at runtime
		// (positron-data-driver-odbc is registered in extensionsWithNpmDeps so its dependencies are
		// packaged). Only odbcWorker.ts imports it; the extension host bundle never loads the
		// native binding.
		external: ['vscode', 'positron', 'odbc'],
	},
}, process.argv);
