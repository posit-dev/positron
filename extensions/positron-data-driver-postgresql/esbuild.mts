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
		// pg is externalized so the dynamic import() in postgresqlConnection stays
		// a deferred load: opening the Data Connections pane activates this
		// extension, and a user who never connects to PostgreSQL should not pay
		// to parse pg. positron-data-driver-postgresql is registered in
		// extensionsWithNpmDeps (build/lib/extensions.ts) so pg is packaged.
		//
		// pg-native is an optional native dependency of pg; leave it as an
		// external so its require() at runtime can no-op gracefully when
		// callers don't opt into pg.native.
		external: ['vscode', 'positron', 'pg', 'pg-native'],
	},
}, process.argv);
