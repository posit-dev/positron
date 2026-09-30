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
		// pg and the AWS SDK bundle into their own entry points rather than
		// into extension.js, and the dynamic imports in redshiftClient and
		// redshiftConnection load them on first use. Opening the Data
		// Connections pane activates this extension, and a user who never
		// connects to Redshift should not pay to parse either. The AWS SDK is
		// only reachable through the IAM auth mechanism, so even a Redshift
		// user on password auth never loads it.
		'pg': path.join(srcDir, 'pg.ts'),
		'redshiftIamCredentials': path.join(srcDir, 'redshiftIamCredentials.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// The two sibling bundles stay external so the dynamic imports that
		// reach them remain real deferred loads at runtime rather than being
		// inlined into extension.js. esbuild matches relative externals
		// against the specifier as written, so the imports must use exactly
		// these paths, including the '.js' suffix.
		//
		// pg-native is an optional native dependency of pg; leave it as an
		// external so its require() at runtime can no-op gracefully when
		// callers don't opt into pg.native.
		external: [
			'vscode',
			'positron',
			'./pg.js',
			'./redshiftIamCredentials.js',
			'pg-native',
		],
		// The dependency trees of pg and the AWS SDK ship inside the bundles;
		// keep the license comments they carry instead of letting minify drop
		// them.
		legalComments: 'eof',
	},
}, process.argv);
