/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test, beforeEach, afterEach } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	assertDuckdbVersionsMatch,
	checkSharedDuckdbRuntime,
	duckdbBindingPackage,
	isDuckdbRuntimeFile
} from '../positron-duckdb-runtime.ts';
import { checkPackagedTree } from '../positron-check-path-lengths.ts';

/** Writes each file of `files`, relative to `root`. */
function writeTree(root: string, files: Record<string, string>): void {
	for (const [relativePath, contents] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
		fs.writeFileSync(path.join(root, relativePath), contents);
	}
}

function manifest(version: string, dependencies: Record<string, string> = {}): string {
	return JSON.stringify({ version, dependencies });
}

/** A packaged `extensions/` directory with a complete shared runtime for darwin-arm64. */
const COMPLETE_TREE: Record<string, string> = {
	'positron-duckdb/package.json': '{}',
	'positron-data-driver-duckdb/package.json': '{}',
	'positron-data-driver-pins/package.json': '{}',
	'positron-data-driver-pins/node_modules/js-yaml/package.json': manifest('4.1.0'),
	'node_modules/@duckdb/node-api/package.json': manifest('1.5.5-r.3', { '@duckdb/node-bindings': '1.5.5-r.3' }),
	'node_modules/@duckdb/node-bindings/package.json': manifest('1.5.5-r.3', { 'detect-libc': '^2.1.2' }),
	'node_modules/@duckdb/node-bindings/duckdb.js': '',
	'node_modules/@duckdb/node-bindings-darwin-arm64/package.json': manifest('1.5.5-r.3'),
	'node_modules/@duckdb/node-bindings-darwin-arm64/duckdb.node': '',
	'node_modules/detect-libc/package.json': manifest('2.1.2'),
};

suite('positron-duckdb-runtime', () => {

	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-duckdb-runtime-'));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('isDuckdbRuntimeFile matches the runtime packages only, with either separator', () => {
		const paths = [
			'node_modules/@duckdb/node-api/lib/index.js',
			'node_modules\\@duckdb\\node-bindings-win32-x64\\duckdb.node',
			'node_modules/detect-libc/lib/detect-libc.js',
			'node_modules/js-yaml/index.js',
			'node_modules/@duckdbx/other/index.js',
			'dist/duckdbWorker.js',
		];

		assert.deepStrictEqual(paths.filter(isDuckdbRuntimeFile), paths.slice(0, 3));
	});

	test('duckdbBindingPackage names the binding for each build target', () => {
		const targets = [
			['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['win32', 'arm64'],
			['linux', 'x64'], ['linux', 'arm64'], ['alpine', 'arm64'], ['linux', 'alpine'], ['linux', 'armhf'],
		];

		assert.deepStrictEqual(Object.fromEntries(targets.map(([platform, arch]) => [`${platform}-${arch}`, duckdbBindingPackage(platform, arch)])), {
			'darwin-arm64': '@duckdb/node-bindings-darwin-arm64',
			'darwin-x64': '@duckdb/node-bindings-darwin-x64',
			'win32-x64': '@duckdb/node-bindings-win32-x64',
			'win32-arm64': '@duckdb/node-bindings-win32-arm64',
			'linux-x64': '@duckdb/node-bindings-linux-x64',
			'linux-arm64': '@duckdb/node-bindings-linux-arm64',
			'alpine-arm64': '@duckdb/node-bindings-linux-arm64-musl',
			'linux-alpine': '@duckdb/node-bindings-linux-x64-musl',
			'linux-armhf': undefined,
		});
	});

	suite('assertDuckdbVersionsMatch', () => {

		function install(extensionName: string, version: string): Record<string, string> {
			return {
				[`${extensionName}/node_modules/@duckdb/node-api/package.json`]: manifest(version),
				[`${extensionName}/node_modules/@duckdb/node-bindings/package.json`]: manifest(version),
			};
		}

		test('passes when every extension installed the same versions', () => {
			writeTree(root, {
				...install('positron-duckdb', '1.5.5-r.3'),
				...install('positron-data-driver-duckdb', '1.5.5-r.3'),
				...install('positron-data-driver-pins', '1.5.5-r.3'),
			});

			assert.doesNotThrow(() => assertDuckdbVersionsMatch(root));
		});

		test('fails on a different version, and names every extension', () => {
			writeTree(root, {
				...install('positron-duckdb', '1.5.5-r.3'),
				...install('positron-data-driver-duckdb', '1.5.5-r.3'),
				...install('positron-data-driver-pins', '1.5.5-r.99'),
			});

			assert.throws(() => assertDuckdbVersionsMatch(root), {
				message: 'The extensions that share DuckDB must install the same version of @duckdb/node-api '
					+ '(positron-duckdb: 1.5.5-r.3, positron-data-driver-duckdb: 1.5.5-r.3, positron-data-driver-pins: 1.5.5-r.99). '
					+ 'Pin the same exact version in each package.json and run npm install.'
			});
		});

		test('fails when an extension has not installed DuckDB', () => {
			writeTree(root, {
				...install('positron-duckdb', '1.5.5-r.3'),
				...install('positron-data-driver-duckdb', '1.5.5-r.3'),
			});

			assert.throws(() => assertDuckdbVersionsMatch(root), /positron-data-driver-pins: not installed/);
		});
	});

	suite('checkSharedDuckdbRuntime', () => {

		test('passes a complete runtime', () => {
			writeTree(root, COMPLETE_TREE);

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'darwin', 'arm64'), []);
		});

		test('passes a tree that ships none of the DuckDB extensions', () => {
			writeTree(root, { 'markdown-language-features/package.json': '{}' });

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'darwin', 'arm64'), []);
		});

		test('fails when the shared runtime is missing', () => {
			writeTree(root, { 'positron-duckdb/package.json': '{}' });

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'linux', 'x64'), [
				'node_modules/@duckdb/node-api is missing',
				'node_modules/@duckdb/node-bindings is missing',
				'node_modules/@duckdb/node-bindings-linux-x64/duckdb.node is missing',
			]);
		});

		test('fails when a cross-build staged the binding of the host', () => {
			writeTree(root, COMPLETE_TREE);

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'darwin', 'x64'), [
				'node_modules/@duckdb/node-bindings-darwin-x64/duckdb.node is missing',
				'node_modules/@duckdb/node-bindings-darwin-arm64 does not match the darwin-x64 target',
			]);
		});

		test('allows a musl binding next to the glibc binding of the same target', () => {
			writeTree(root, {
				...COMPLETE_TREE,
				'node_modules/@duckdb/node-bindings-linux-x64/duckdb.node': '',
				'node_modules/@duckdb/node-bindings-linux-x64-musl/duckdb.node': '',
			});
			fs.rmSync(path.join(root, 'node_modules/@duckdb/node-bindings-darwin-arm64'), { recursive: true });

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'linux', 'x64'), []);
		});

		test('fails when an extension ships its own copy', () => {
			writeTree(root, {
				...COMPLETE_TREE,
				'positron-data-driver-pins/node_modules/@duckdb/node-api/package.json': manifest('1.5.5-r.3'),
				'positron-data-driver-pins/node_modules/detect-libc/package.json': manifest('2.1.2'),
			});

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'darwin', 'arm64'), [
				'positron-data-driver-pins ships its own node_modules/@duckdb, which must come from the shared node_modules',
				'positron-data-driver-pins ships its own node_modules/detect-libc, which must come from the shared node_modules',
			]);
		});

		test('fails when a runtime dependency does not resolve in the shared node_modules', () => {
			writeTree(root, {
				...COMPLETE_TREE,
				'node_modules/@duckdb/node-bindings/package.json': manifest('1.5.5-r.3', { 'detect-libc': '^2.1.2', 'new-dependency': '^1.0.0' }),
			});
			fs.rmSync(path.join(root, 'node_modules/detect-libc'), { recursive: true });

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'darwin', 'arm64'), [
				'@duckdb/node-bindings depends on detect-libc, which is not in the shared node_modules. Add it to DUCKDB_RUNTIME_PACKAGES',
				'@duckdb/node-bindings depends on new-dependency, which is not in the shared node_modules. Add it to DUCKDB_RUNTIME_PACKAGES',
			]);
		});

		test('resolves a dependency nested inside the package that needs it', () => {
			writeTree(root, {
				...COMPLETE_TREE,
				'node_modules/@duckdb/node-bindings/node_modules/detect-libc/package.json': manifest('2.1.2'),
			});
			fs.rmSync(path.join(root, 'node_modules/detect-libc'), { recursive: true });

			assert.deepStrictEqual(checkSharedDuckdbRuntime(root, 'darwin', 'arm64'), []);
		});
	});

	suite('checkPackagedTree', () => {

		const budgets = { total: 100, default: 100, byExtension: new Map() };

		test('fails the packaged tree when the runtime is incomplete for the target', () => {
			writeTree(path.join(root, 'resources/app/extensions'), COMPLETE_TREE);

			assert.throws(
				() => checkPackagedTree(root, 'resources/app/extensions', { pathLengths: false, budgets, duckdbTarget: { platform: 'win32', arch: 'x64' } }),
				/the shared DuckDB runtime is incomplete: node_modules\/@duckdb\/node-bindings-win32-x64\/duckdb.node is missing/);
		});

		test('passes the packaged tree when the runtime is complete for the target', () => {
			writeTree(path.join(root, 'resources/app/extensions'), COMPLETE_TREE);

			assert.doesNotThrow(() => checkPackagedTree(root, 'resources/app/extensions', { pathLengths: false, budgets, duckdbTarget: { platform: 'darwin', arch: 'arm64' } }));
		});
	});
});
