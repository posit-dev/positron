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
		// snowflake-sdk bundles into its own entry point rather than into
		// extension.js, so activation does not pay to parse the SDK's 3.5 MB
		// bundle. The dynamic import in snowflakeClient.ts loads this file on
		// the first connection attempt instead.
		'snowflakeSdk': path.join(srcDir, 'snowflakeSdk.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// snowflake-sdk bundles cleanly: the only dynamic require in the SDK
		// is the native minicore loader in dist/lib/minicore/minicore.js,
		// which uses eval('require') so bundlers leave it alone, and the
		// version read is a static require of package.json that esbuild
		// inlines. Minicore backs Snowflake's in-band telemetry only: the SDK
		// tolerates the binary being missing (see isBinaryIgnoredByBundlers
		// there) and honors SNOWFLAKE_DISABLE_MINICORE, so no .node binaries
		// ship and the loader's failure is caught at load time.
		//
		// './snowflakeSdk.js' stays external so the dynamic import in
		// snowflakeClient.ts remains a real deferred load of the sibling
		// bundle at runtime rather than being inlined into extension.js.
		external: ['vscode', 'positron', './snowflakeSdk.js'],
		// The SDK's dependency tree ships inside the bundle; keep the license
		// comments its dependencies carry instead of letting minify drop
		// them.
		legalComments: 'eof',
	},
}, process.argv);
