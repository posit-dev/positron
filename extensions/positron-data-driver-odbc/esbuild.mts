/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist');

/**
 * Copies odbc's native binding next to the odbcWorker bundle, where
 * src/nodePreGypStub.ts finds it. The path comes from the real node-pre-gyp,
 * so it is the same binding that odbc loads from node_modules. A missing
 * binding fails the build rather than shipping a driver that cannot load.
 */
async function copyOdbcBinding(outDir: string): Promise<void> {
	const require = createRequire(import.meta.url);
	const nodePreGyp: { find(packageJsonPath: string): string } = require('@mapbox/node-pre-gyp');
	const bindingPath = nodePreGyp.find(require.resolve('odbc/package.json'));
	await fs.promises.copyFile(bindingPath, path.join(outDir, 'odbc.node'));
}

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
		// odbc's JavaScript bundles into odbcWorker.js; only odbcWorker.ts imports it, so the
		// extension host bundle never loads the native binding. odbc locates its binding with
		// @mapbox/node-pre-gyp, an install-time tool whose dependency tree would otherwise ship.
		// The alias replaces it with a stub that points at the copy of the binding in dist/.
		alias: {
			'@mapbox/node-pre-gyp': path.join(srcDir, 'nodePreGypStub.ts'),
		},
		// odbc's dependencies ship inside the bundle; keep the license comments they carry
		// instead of letting minify drop them.
		legalComments: 'eof',
	},
}, process.argv, copyOdbcBinding);
