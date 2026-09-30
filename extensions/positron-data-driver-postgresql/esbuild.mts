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
		// pg bundles into its own entry point rather than into extension.js.
		// Opening the Data Connections pane activates this extension, and a
		// user who never connects to PostgreSQL should not pay to parse pg.
		// The dynamic import in postgresqlConnection.ts loads this file on the
		// first connection attempt instead.
		'pg': path.join(srcDir, 'pg.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// './pg.js' stays external so the dynamic import in
		// postgresqlConnection.ts remains a real deferred load of the sibling
		// bundle at runtime rather than being inlined into extension.js.
		// esbuild matches relative externals against the specifier as
		// written, so the import must use exactly './pg.js'.
		//
		// pg-native is an optional native dependency of pg; leave it as an
		// external so its require() at runtime can no-op gracefully when
		// callers don't opt into pg.native.
		external: ['vscode', 'positron', './pg.js', 'pg-native'],
		// pg's dependency tree ships inside the bundle; keep the license
		// comments its dependencies carry instead of letting minify drop
		// them.
		legalComments: 'eof',
	},
}, process.argv);
