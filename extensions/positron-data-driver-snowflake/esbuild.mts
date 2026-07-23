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
		// snowflake-sdk is a large package with dynamic requires (it lazy-loads
		// transports and reads its own package.json at runtime for the client
		// version it reports to Snowflake), which esbuild cannot bundle cleanly.
		// Externalize it so it's loaded from node_modules at runtime;
		// positron-data-driver-snowflake is registered in extensionsWithNpmDeps
		// (build/lib/extensions.ts) so its dependencies are packaged.
		external: ['vscode', 'positron', 'snowflake-sdk'],
	},
}, process.argv);
