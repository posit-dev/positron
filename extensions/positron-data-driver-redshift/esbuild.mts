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
		// pg and the AWS SDK are externalized so the dynamic import()s in
		// redshiftClient and redshiftConnection stay deferred loads: opening the
		// Data Connections pane activates this extension, and a user who never
		// connects to Redshift should not pay to parse either. The AWS SDK is
		// only reachable through the IAM auth mechanism, so even a Redshift user
		// on password auth never loads it. positron-data-driver-redshift is
		// registered in extensionsWithNpmDeps (build/lib/extensions.ts) so all of
		// these are packaged.
		//
		// pg-native is an optional native dependency of pg; leave it as an
		// external so its require() at runtime can no-op gracefully when
		// callers don't opt into pg.native.
		external: [
			'vscode',
			'positron',
			'pg',
			'pg-native',
			'@aws-sdk/client-redshift',
			'@aws-sdk/client-redshift-serverless',
			'@aws-sdk/credential-providers',
		],
	},
}, process.argv);
