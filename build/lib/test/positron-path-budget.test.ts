/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { suite, test } from 'node:test';
import { AI_LIB_SERVER_PACKAGES, getAiLibServerModules } from '../ai-lib-dependencies.ts';
import {
	DEFAULT_EXTENSION_FILE_COUNT_BUDGET,
	EXTENSION_FILE_COUNT_BUDGETS,
	MAX_RELATIVE_PATH_LENGTH,
	isPrunedExtensionDependencyFile as isPruned,
	isPrunedServerDependencyFile,
	isUnusedCopilotOpenTelemetryPackage,
} from '../positron-path-budget.ts';

const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');

/** The closure is read off the real install, so skip when it isn't there. */
const installed = AI_LIB_SERVER_PACKAGES.every(
	name => fs.existsSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json')));

interface ResolveRecord {
	spec: string;
	mode: 'esm' | 'cjs';
	resolved?: string;
	errorCode?: string;
}

const ESM_RESOLVER = path.join(import.meta.dirname, 'fixtures', 'resolve-esm.mjs');

/**
 * Resolves the specifiers as an import or a `require` from `parentFile` would.
 * The file does not need to exist.
 *
 * CommonJS resolves in process through `createRequire`, which takes the parent
 * directly. ESM resolves in a child process, because only
 * `import.meta.resolve` with `--experimental-import-meta-resolve` takes a
 * parent (see fixtures/resolve-esm.mjs). A child that fails throws, so a
 * broken guard cannot pass.
 */
function resolveInBothModes(parentFile: string, specs: string[]): ResolveRecord[] {
	const esm: ResolveRecord[] = JSON.parse(execFileSync(
		process.execPath,
		['--experimental-import-meta-resolve', ESM_RESOLVER, pathToFileURL(parentFile).href, JSON.stringify(specs)],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

	const require = createRequire(parentFile);
	const cjs = specs.map((spec): ResolveRecord => {
		try {
			return { spec, mode: 'cjs', resolved: require.resolve(spec) };
		} catch (e) {
			return { spec, mode: 'cjs', errorCode: (e as NodeJS.ErrnoException).code };
		}
	});

	return [...esm, ...cjs];
}

/**
 * Specifiers that Node resolves but no shipped Node build loads, so the server
 * prune removes their files on purpose. Only the browser build of
 * @azure/identity (itself pruned) and msal-browser import them; the walk test
 * below proves that no remaining file references them.
 */
const BROWSER_ONLY_SPECIFIERS = ['@azure/msal-browser', '@azure/msal-common/browser'];

/** Whether the specifier is one of `BROWSER_ONLY_SPECIFIERS` or a subpath of one. */
function isBrowserOnlySpecifier(spec: string): boolean {
	return BROWSER_ONLY_SPECIFIERS.some(exempt => spec === exempt || spec.startsWith(exempt + '/'));
}

/** The specifiers Node can resolve for a package, from its `exports` map. */
function entryPointSpecifiers(name: string, packageJson: { exports?: unknown }): string[] {
	const exp = packageJson.exports;
	if (exp === undefined || exp === null || typeof exp === 'string' || Array.isArray(exp)) {
		return [name];
	}
	const keys = Object.keys(exp as object);
	if (!keys.some(key => key.startsWith('.'))) {
		return [name];
	}
	return [name, ...keys.filter(key => key.startsWith('./') && !key.includes('*')).map(key => name + key.slice(1))];
}

suite('positron-path-budget', () => {

	test('budget leaves room for a long account name during a background update', () => {
		// 259 usable - 42 install prefix - 2 for the {app}\_ update staging
		// directory - 20 for the account name. This test exists to catch one
		// mistake: a smaller allowance that makes a long path fit.
		assert.strictEqual(MAX_RELATIVE_PATH_LENGTH, 195);
	});

	test('the path from the original report does not fit, the one that replaced it does', () => {
		// The first path comes from the released 2026.08.0-331 Windows user
		// installer, relative to the install directory; it broke installs and
		// auto-updates. positron-data-driver-snowflake pulls in the
		// @azure/msal-browser package (transitively, via @azure/identity, a
		// dependency of snowflake-sdk) and owns the longest path.
		const before = 'resources\\app\\extensions\\positron-data-driver-snowflake\\node_modules\\@aws-sdk\\middleware-sdk-s3\\dist-types\\ts3.4\\submodules\\s3-control\\middleware-host-prefix-deduplication\\hostPrefixDeduplicationMiddleware.d.ts';
		const after = 'resources\\app\\extensions\\positron-data-driver-snowflake\\node_modules\\@azure\\msal-browser\\dist\\custom_auth\\core\\auth_flow\\jit\\result\\AuthMethodRegistrationChallengeMethodResult.mjs.map';

		assert.deepStrictEqual(
			{
				before: { length: before.length, fits: before.length <= MAX_RELATIVE_PATH_LENGTH },
				after: { length: after.length, fits: after.length <= MAX_RELATIVE_PATH_LENGTH },
				beforeIsPruned: isPruned(before.slice('resources\\app\\extensions\\positron-data-driver-snowflake\\'.length)),
			},
			{
				before: { length: 210, fits: false },
				after: { length: 183, fits: true },
				beforeIsPruned: true,
			});
	});

	suite('isPrunedExtensionDependencyFile', () => {

		test('prunes declarations and ESM twins, keeps runtime files', () => {
			const paths = [
				// The longest path that Positron shipped, and its siblings.
				'node_modules/@aws-sdk/middleware-sdk-s3/dist-types/ts3.4/submodules/s3-control/x.d.ts',
				'node_modules/@aws-sdk/middleware-sdk-s3/dist-es/submodules/s3-control/x.js',
				'node_modules/@smithy/middleware-endpoint/dist-es/adaptors/x.js',
				'node_modules/@azure/msal-browser/types/custom_auth/core/x.d.ts.map',
				'node_modules/snowflake-sdk/lib/core.ts',
				// Runtime files, which must stay in the package.
				'node_modules/@aws-sdk/middleware-sdk-s3/dist-cjs/index.js',
				'node_modules/@smithy/middleware-endpoint/dist-cjs/index.js',
				'node_modules/snowflake-sdk/lib/core.js',
				'node_modules/snowflake-sdk/package.json',
				'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
				// The prune removes `dist-es` only for the two scopes that load
				// their CommonJS build. For another package, `dist-es` can be
				// the only build.
				'node_modules/some-esm-only-package/dist-es/index.js',
				// The prune reads only node_modules, not the output of the
				// extension.
				'dist/extension.js',
				'src/extension.ts',
				// node-pre-gyp's scratch dir from a source-build fallback.
				'node_modules/odbc/build-tmp-napi-v8/Release/.deps/x.d',
				// The compiled binary the package resolves at runtime stays.
				'node_modules/odbc/lib/bindings/napi-v8/odbc.node',
			];

			assert.deepStrictEqual(paths.map(isPruned), [
				true, true, true, true, true,
				false, false, false, false, false,
				false,
				false, false,
				true,
				false,
			]);
		});

		test('does not mistake .mts or .mjs for a declaration file', () => {
			assert.deepStrictEqual([
				'node_modules/pkg/dist/index.mts',
				'node_modules/pkg/dist/index.mjs',
				'node_modules/pkg/dist/index.cjs',
			].map(isPruned), [false, false, false]);
		});

		test('matches the native separators vsce reports on Windows', () => {
			assert.deepStrictEqual([
				'node_modules\\@aws-sdk\\middleware-sdk-s3\\dist-types\\ts3.4\\x.d.ts',
				'node_modules\\@aws-sdk\\middleware-sdk-s3\\dist-cjs\\index.js',
			].map(isPruned), [true, false]);
		});

		test('prunes a dotfile, which a default glob would skip', () => {
			assert.strictEqual(isPruned('node_modules/pkg/.internal/index.d.ts'), true);
		});
	});

	suite('isPrunedServerDependencyFile', () => {

		test('prunes maps, declarations, and other-runtime builds, keeps runtime files', () => {
			const pruned = [
				'node_modules/@azure/msal-browser/types/custom_auth/x.d.ts.map',
				'node_modules/ai-provider-bridge/dist/chunk-X.js.map',
				'node_modules/tar/dist/esm/index.mjs.map',
				'node_modules/zod/v4/core/x.d.cts',
				'node_modules/zod/v4/core/x.d.mts',
				'node_modules/@smithy/core/dist-es/submodules/protocols/index.js',
				'node_modules/@aws-sdk/client-bedrock/dist-es/index.js',
				'node_modules/@azure/identity/dist/browser/index.js',
				'node_modules/@azure/identity/dist/workerd/index.js',
				'node_modules/@azure/core-client/dist/react-native/index.js',
				'node_modules/@typespec/ts-http-runtime/dist/react-native/index.js',
				'node_modules/@azure/msal-common/dist-browser/index.mjs',
				'node_modules/@azure/msal-node/node_modules/@azure/msal-common/dist-browser/index.mjs',
				'node_modules/@azure/msal-browser/dist/index.mjs',
				'node_modules/@vscode/codicons/src/icons/add.svg',
				'node_modules/@vscode/codicons/scripts/svg-sprite.js',
				'node_modules/@vscode/codicons/_iconCloud/manifest.json',
				'node_modules/@vscode/codicons/build/pipeline.yml',
				'node_modules/@vscode/codicons/preview.png',
			];
			const kept = [
				'node_modules/@smithy/core/dist-cjs/index.js',
				// Not an @aws-sdk or @smithy package, so its dist-es stays.
				'node_modules/@aws/lambda-invoke-store/dist-es/invoke-store.js',
				'node_modules/@azure/identity/dist/esm/index.js',
				'node_modules/@azure/identity/dist/commonjs/index.js',
				// A file name, not a directory.
				'node_modules/@azure/identity/dist/esm/browser.js',
				'node_modules/@azure/msal-node/dist/index.mjs',
				'node_modules/@vscode/codicons/dist/codicon.css',
				'node_modules/@vscode/codicons/dist/codicon.ttf',
				'node_modules/typescript/lib/lib.es2020.d.ts',
				'node_modules/zod/v4/core/index.cjs',
				// A directory named like a source map.
				'node_modules/es-iterator-helpers/Iterator.prototype.map/index.js',
				'node_modules/object.map/index.js',
			];

			assert.deepStrictEqual([...pruned, ...kept].map(isPrunedServerDependencyFile), [
				...pruned.map(() => true),
				...kept.map(() => false),
			]);
		});

		test('accepts Windows separators', () => {
			assert.strictEqual(
				isPrunedServerDependencyFile('node_modules\\@azure\\identity\\dist\\browser\\index.js'),
				true);
		});
	});

	suite('server prune keeps resolved files', () => {

		test('no export of a cloud SDK package in the ai-lib closure resolves to a pruned file', { skip: !installed }, () => {
			const scoped = getAiLibServerModules()
				.filter(m => /(^|\/)node_modules\/@(aws-sdk|smithy|azure|typespec)\//.test(m.destination));
			assert.ok(scoped.length > 0, 'expected cloud SDK modules in the ai-lib closure');

			// Resolve from a file in the directory that holds the package directory
			// (the scope directory for a scoped package). Node's walk up from there
			// finds a nested copy before the hoisted one, and it does not
			// self-resolve the package through its own `exports`.
			const groups = new Map<string, { source: string; destination: string; name: string; specs: string[] }[]>();
			for (const module of scoped) {
				const sourceDir = path.join(REPO_ROOT, module.source);
				const packageJson = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
				const entry = { ...module, name: packageJson.name as string, specs: entryPointSpecifiers(packageJson.name, packageJson).filter(spec => !isBrowserOnlySpecifier(spec)) };
				const parentFile = path.join(path.dirname(sourceDir), 'importer.js');
				groups.set(parentFile, [...(groups.get(parentFile) ?? []), entry]);
			}

			const pruned: string[] = [];
			const unexpectedErrors: string[] = [];
			const unresolvedModules: string[] = [];
			for (const [parentFile, entries] of groups) {
				const records = resolveInBothModes(parentFile, entries.flatMap(e => e.specs));
				for (const e of entries) {
					if (e.specs.length > 0 && !records.some(r => r.resolved !== undefined && e.specs.includes(r.spec))) {
						unresolvedModules.push(e.destination);
					}
				}
				for (const record of records) {
					if (record.errorCode === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
						continue;
					}
					if (record.resolved === undefined) {
						unexpectedErrors.push(`${record.mode} ${record.spec}: ${record.errorCode ?? 'no error code'}`);
						continue;
					}
					const file = record.resolved.startsWith('file:') ? fileURLToPath(record.resolved) : record.resolved;
					const owner = entries.find(e => record.spec === e.name || record.spec.startsWith(e.name + '/'));
					const relative = owner && path.relative(path.join(REPO_ROOT, owner.source), file);
					if (!owner || relative === undefined || relative.startsWith('..')) {
						unexpectedErrors.push(`${record.mode} ${record.spec}: resolved outside its package: ${file}`);
						continue;
					}
					const serverPath = `${owner.destination}/${relative.split(path.sep).join('/')}`;
					if (isPrunedServerDependencyFile(serverPath)) {
						pruned.push(`${record.mode} ${record.spec} -> ${serverPath}`);
					}
				}
			}

			assert.deepStrictEqual({ pruned, unexpectedErrors }, { pruned: [], unexpectedErrors: [] });
			// Every module with a non-exempt specifier resolved at least one, so
			// the guard cannot pass without checking it.
			assert.deepStrictEqual(unresolvedModules, []);
		});

		test('no shipped file in the ai-lib closure imports a browser-only specifier', { skip: !installed }, () => {
			// Includes @azure/identity dist/esm and dist/commonjs, which ship.
			const found: string[] = [];
			let scanned = 0;
			for (const module of getAiLibServerModules()) {
				const sourceDir = path.join(REPO_ROOT, module.source);
				const scan = (dir: string) => {
					for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
						const entryPath = path.join(dir, entry.name);
						if (entry.isDirectory()) {
							// A nested package is its own module in the list.
							if (entry.name !== 'node_modules') {
								scan(entryPath);
							}
						} else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
							const relative = path.relative(sourceDir, entryPath).split(path.sep).join('/');
							const serverPath = `${module.destination}/${relative}`;
							if (isPrunedServerDependencyFile(serverPath)) {
								continue;
							}
							scanned++;
							const contents = fs.readFileSync(entryPath, 'utf8');
							if (BROWSER_ONLY_SPECIFIERS.some(spec => contents.includes(spec))) {
								found.push(serverPath);
							}
						}
					}
				};
				scan(sourceDir);
			}

			assert.deepStrictEqual({ found, scanned: scanned > 0 }, { found: [], scanned: true });
		});
	});

	suite('isUnusedCopilotOpenTelemetryPackage', () => {

		test('keeps the externalized instrumentation closure, drops the bundled rest', () => {
			const dependencies = [
				// External in extensions/copilot/.esbuild.mts. The extension
				// therefore loads these from node_modules at runtime.
				'extensions/copilot/node_modules/@opentelemetry/instrumentation',
				'extensions/copilot/node_modules/@opentelemetry/api',
				'extensions/copilot/node_modules/@opentelemetry/core',
				// Inside dist/extension.js, so dead weight on disk. The nested
				// resources copies are the source of the paths in #14702.
				'extensions/copilot/node_modules/@opentelemetry/exporter-metrics-otlp-grpc',
				'extensions/copilot/node_modules/@opentelemetry/resources',
				'extensions/copilot/node_modules/@opentelemetry/sdk-trace-node',
				// The prune keeps this package at the top level. But when the
				// prune removes a parent package, it also removes the nested
				// copy, so that the glob of the parent cannot return it.
				'extensions/copilot/node_modules/@opentelemetry/exporter-trace-otlp-grpc/node_modules/@opentelemetry/core',
				// The prune does not touch an unrelated dependency.
				'extensions/copilot/node_modules/@github/copilot',
				'extensions/copilot/node_modules/shimmer',
			];

			assert.deepStrictEqual(dependencies.map(isUnusedCopilotOpenTelemetryPackage), [
				false, false, false,
				true, true, true,
				true,
				false, false,
			]);
		});

		test('ignores a trailing @opentelemetry segment with no package after it', () => {
			assert.strictEqual(
				isUnusedCopilotOpenTelemetryPackage('extensions/copilot/node_modules/@opentelemetry'),
				false);
		});

		test('handles Windows separators', () => {
			assert.strictEqual(
				isUnusedCopilotOpenTelemetryPackage(
					'extensions\\copilot\\node_modules\\@opentelemetry\\resources'),
				true);
		});
	});

	suite('file-count budgets', () => {

		test('each entry names a directory that ships and is above the default budget', () => {
			// An entry for a removed or renamed extension, or one at or below the
			// default, would check nothing. `node_modules` is the shared tree that
			// the build creates, and the product.json extensions are downloaded
			// at build time rather than kept in the repo.
			const repoRoot = path.join(import.meta.dirname, '..', '..', '..');
			const product = JSON.parse(fs.readFileSync(path.join(repoRoot, 'product.json'), 'utf8'));
			const downloaded = new Set<string>([...product.builtInExtensions, ...product.bootstrapExtensions]
				.map((extension: { name: string }) => extension.name));
			const stale = [...EXTENSION_FILE_COUNT_BUDGETS]
				.filter(([name, budget]) => budget <= DEFAULT_EXTENSION_FILE_COUNT_BUDGET
					|| (name !== 'node_modules' && !downloaded.has(name)
						&& !fs.existsSync(path.join(repoRoot, 'extensions', name, 'package.json'))))
				.map(([name]) => name);

			assert.deepStrictEqual(stale, []);
		});
	});
});
