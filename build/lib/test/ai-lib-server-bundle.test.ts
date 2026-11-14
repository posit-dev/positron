/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { after, before, suite, test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	AI_LIB_SERVER_FILE_BUDGET,
	AI_LIB_SERVER_LOOKUP_ALLOWLIST,
	AI_LIB_SERVER_ENTRY,
	bundleAiLibServer,
	checkFileBudget,
	checkNoBuildWarnings,
	findUnreviewedLookups,
	runInAiLibServerIsolation,
} from '../ai-lib-server-bundle.ts';

const REPO_ROOT = path.dirname(path.dirname(path.dirname(import.meta.dirname)));

/** The bundle is built from the real install, so skip when it isn't there. */
const installed = fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'ai-provider-bridge', 'package.json'));

suite('ai-lib-server-bundle', () => {

	suite('bundleAiLibServer', { skip: !installed }, () => {
		let outDir: string;
		let written: string[];
		const packageDir = () => path.join(outDir, 'node_modules', 'ai-provider-bridge');

		before(async () => {
			outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-lib-server-bundle-'));
			written = await bundleAiLibServer(outDir);
		});

		after(() => {
			fs.rmSync(outDir, { recursive: true, force: true });
		});

		test('writes a package that exports only the headless entry', () => {
			const source = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules', 'ai-provider-bridge', 'package.json'), 'utf8'));
			const manifest = JSON.parse(fs.readFileSync(path.join(packageDir(), 'package.json'), 'utf8'));
			assert.deepStrictEqual(manifest, {
				name: 'ai-provider-bridge',
				version: source.version,
				type: 'module',
				exports: { './headless': './dist/headless.js' },
			});
		});

		test('writes few files', () => {
			assert.ok(written.length <= AI_LIB_SERVER_FILE_BUDGET, `${written.length} files`);
			assert.deepStrictEqual(written.filter(file => file.endsWith('.map')), []);
		});

		test('lists every bundled package in the notices', () => {
			const notices = fs.readFileSync(path.join(packageDir(), 'THIRD_PARTY_NOTICES.txt'), 'utf8');
			// The first section is the file's preamble.
			const sections = notices.split(/^-{80}$/m).slice(1).map(section => section.trim());
			const names = new Set<string>();
			for (const section of sections) {
				const [heading, ...body] = section.split('\n');
				const name = /^(?<name>(?:@[^/\s]+\/)?[^@\s]+)@\S+ \(.+\)$/.exec(heading)?.groups?.name;
				assert.ok(name, `not a heading: ${heading}`);
				assert.ok(body.join('\n').trim().length > 0, `empty license text for ${heading}`);
				names.add(name);
			}

			// Every package with code in the bundle, read off esbuild's module comments.
			const bundled = new Set<string>();
			for (const file of written.filter(file => file.endsWith('.js'))) {
				for (const match of fs.readFileSync(path.join(outDir, file), 'utf8').matchAll(/^\/\/ (?<modulePath>\S+\.[cm]?js)$/gm)) {
					const modulePath = match.groups!.modulePath;
					const name = /.*node_modules\/(?<name>(?:@[^/]+\/)?[^/]+)\//.exec(modulePath)?.groups?.name
						?? /ai-lib\/packages\/(?<name>[^/]+)\//.exec(modulePath)?.groups?.name;
					assert.ok(name, `no package for ${modulePath}`);
					bundled.add(name);
				}
			}
			assert.deepStrictEqual([...bundled].filter(name => !names.has(name)), []);

			// data-uri-to-buffer ships no license file, so the SPDX fallback is covered.
			for (const name of ['@azure/identity', 'zod', 'data-uri-to-buffer', 'ai-provider-bridge', 'ai-config']) {
				assert.ok(bundled.has(name), `${name} is not in the bundle`);
				assert.ok(names.has(name), `missing notice for ${name}`);
			}
		});

		// The `before` hook already passed the isolation check that
		// `bundleAiLibServer` runs on every build.
		suite('bundle runs in isolation', () => {

			test('the entry exports what the unbundled entry exports', async () => {
				const stdout = await runInAiLibServerIsolation(outDir, () => [
					`const entry = await import(${JSON.stringify(AI_LIB_SERVER_ENTRY)});`,
					`process.stdout.write('\\n' + JSON.stringify({ keys: Object.keys(entry).sort(), version: entry.HEADLESS_CONTRACT_VERSION }));`,
				].join('\n'));
				const bundled = JSON.parse(stdout.trim().split('\n').at(-1)!);

				const unbundled = await import(AI_LIB_SERVER_ENTRY);
				assert.deepStrictEqual(bundled.keys, Object.keys(unbundled).sort());
				assert.strictEqual(bundled.version, unbundled.HEADLESS_CONTRACT_VERSION);
			});

			test('fails when a dependency is left out', async () => {
				const leftOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-lib-server-bundle-external-'));
				try {
					await assert.rejects(bundleAiLibServer(leftOutDir, { external: ['zod'] }), (error: Error) => {
						// Only the child's stderr has these; the hints do not.
						assert.match(error.message, /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package 'zod'/);
						return true;
					});
				} finally {
					fs.rmSync(leftOutDir, { recursive: true, force: true });
				}
			});
		});
	});

	suite('checkFileBudget', () => {

		test('passes at the budget', () => {
			checkFileBudget(['a.js', 'b.js'], 2);
		});

		test('fails over the budget', () => {
			assert.throws(() => checkFileBudget(['a.js', 'b.js', 'c.js'], 2), /3 files/);
		});
	});

	suite('checkNoBuildWarnings', () => {

		test('passes with no warnings', () => {
			checkNoBuildWarnings([]);
		});

		test('fails and lists each warning', () => {
			const warning = {
				id: 'unsupported-require-call',
				pluginName: '',
				text: 'This call to "require" will not be bundled because the argument is not a string literal',
				location: { file: 'node_modules/dep/index.js', namespace: 'file', line: 3, column: 7, length: 10, lineText: 'require(name);', suggestion: '' },
				notes: [],
				detail: undefined,
			};
			assert.throws(() => checkNoBuildWarnings([warning]),
				/1 esbuild warnings:\n  \[unsupported-require-call\] This call to "require" .* at node_modules\/dep\/index\.js:3:7/);
		});
	});

	suite('findUnreviewedLookups', () => {

		const banner = `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`;

		test('fails on an unreviewed file lookup', () => {
			const contents = [
				banner,
				'',
				'// node_modules/some-pkg/index.js',
				'var dir = __dirname;',
				'',
				'// ai-lib/node_modules/@scope/pkg/lib/x.js',
				'var file = __filename;',
				'',
				'// node_modules/a/node_modules/b/x.js',
				'var resolved = require.resolve("./data.json");',
				'',
				'// node_modules/renamed/index.js',
				'var other = __dirname2;',
				'',
				'// node_modules/meta-dir/index.js',
				'var metaDir = import.meta.dirname;',
				'',
				'// node_modules/clean/index.js',
				'var x = 1;',
			].join('\n');

			const lookups = findUnreviewedLookups(new Map([['dist/chunk-X.js', contents]]), new Map());
			assert.deepStrictEqual(lookups.map(({ packageName, file, line }) => ({ packageName, file, line })), [
				{ packageName: 'some-pkg', file: 'dist/chunk-X.js', line: 4 },
				{ packageName: '@scope/pkg', file: 'dist/chunk-X.js', line: 7 },
				{ packageName: 'b', file: 'dist/chunk-X.js', line: 10 },
				{ packageName: 'renamed', file: 'dist/chunk-X.js', line: 13 },
				{ packageName: 'meta-dir', file: 'dist/chunk-X.js', line: 16 },
			]);
		});

		test('names ai-lib code by its package and skips allowlisted packages', () => {
			const contents = [
				banner,
				'// ai-lib/packages/ai-config/dist/node.js',
				'var u = import.meta.url;',
				'// node_modules/open/index.js',
				'var d = __dirname;',
			].join('\n');

			const lookups = findUnreviewedLookups(new Map([['dist/headless.js', contents]]), AI_LIB_SERVER_LOOKUP_ALLOWLIST);
			assert.deepStrictEqual(lookups.map(lookup => lookup.packageName), ['ai-config']);
		});
	});
});
