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
		// @databricks/sql bundles into its own entry point rather than into
		// extension.js, so activation does not pay to parse the SDK. The
		// dynamic import in databricksClient.ts loads this file on the first
		// connection attempt instead.
		'databricksSdk': path.join(srcDir, 'databricksSdk.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// @databricks/sql bundles cleanly: its requires are all static, and
		// the driver version it reports to Databricks is a constant in
		// dist/version.js. The exceptions are its two native modules:
		//
		// - lz4-napi decompresses LZ4-compressed results. It is a napi-rs
		//   package that picks a per-platform .node file at runtime, so it
		//   stays external and ships in node_modules (it is this extension's
		//   only runtime dependency). If it fails to load, the SDK does not
		//   ask the server for compressed results.
		// - '../../native/kernel' is the loader for the optional Rust kernel
		//   backend, which the SDK uses only when a client opts in with the
		//   internal `useKernel` option. This extension never does, so the
		//   kernel's platform binaries do not ship.
		//
		// './databricksSdk.js' stays external so the dynamic import in
		// databricksClient.ts remains a real deferred load of the sibling
		// bundle at runtime rather than being inlined into extension.js.
		external: ['vscode', 'positron', './databricksSdk.js', 'lz4-napi', '../../native/kernel'],
		// The SDK's dependency tree ships inside the bundle; keep the license
		// comments its dependencies carry instead of letting minify drop
		// them.
		legalComments: 'eof',
	},
}, process.argv);
