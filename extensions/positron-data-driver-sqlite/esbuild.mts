/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist');

/**
 * Copies better-sqlite3's native bindings next to the sqliteWorker bundle, where
 * resolveNativeBinding() in sqliteWorker.ts finds them: the Electron-ABI build
 * for the desktop extension host, and the Node-ABI build that
 * build/npm/postinstall.ts adds for the server extension host. A missing binding
 * fails the build rather than shipping a driver that cannot load.
 */
async function copySqliteBindings(outDir: string): Promise<void> {
	const releaseDir = path.join(import.meta.dirname, 'node_modules', 'better-sqlite3', 'build', 'Release');
	for (const fileName of ['better_sqlite3.node', 'better_sqlite3-node.node']) {
		await fs.promises.copyFile(path.join(releaseDir, fileName), path.join(outDir, fileName));
	}
}

run({
	platform: 'node',
	entryPoints: {
		'extension': path.join(srcDir, 'extension.ts'),
		// The SQLite native instance runs in this child process (forked by
		// sqliteWorkerClient.ts) so a native abort cannot take down the extension
		// host. It is emitted next to extension.js and located at runtime via
		// __dirname.
		'sqliteWorker': path.join(srcDir, 'sqliteWorker.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// better-sqlite3's JavaScript bundles into sqliteWorker.js; only
		// sqliteWorker.ts imports it, so the extension host bundle never loads the
		// native binding. The worker passes an explicit nativeBinding path, so
		// better-sqlite3 never needs its own node_modules to find the binary.
		// 'better-sqlite3/package.json' stays external for the require.resolve in
		// the development fallback there, which the bundle never reaches.
		external: ['vscode', 'positron', 'better-sqlite3/package.json'],
		// better-sqlite3's dependencies ship inside the bundle; keep the license
		// comments they carry instead of letting minify drop them.
		legalComments: 'eof',
	},
}, process.argv, copySqliteBindings);
