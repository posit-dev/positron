/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import {
	MAX_RELATIVE_PATH_LENGTH,
	isPrunedExtensionDependencyFile as isPruned,
	isUnusedCopilotOpenTelemetryPackage,
} from '../positron-path-budget.ts';

suite('positron-path-budget', () => {

	test('budget leaves room for a long account name during a background update', () => {
		// 259 usable - 42 install prefix - 2 for the {app}\_ update staging
		// directory - 20 for the account name. This test exists to catch one
		// mistake: a smaller allowance that makes a long path fit.
		assert.strictEqual(MAX_RELATIVE_PATH_LENGTH, 195);
	});

	test('the path from the original report does not fit, the one that replaced it does', () => {
		// Both paths come from the released 2026.08.0-331 Windows user installer,
		// relative to the install directory. The first path broke installs and
		// auto-updates. The second path is the longest path that ships now.
		const before = 'resources\\app\\extensions\\positron-data-driver-snowflake\\node_modules\\@aws-sdk\\middleware-sdk-s3\\dist-types\\ts3.4\\submodules\\s3-control\\middleware-host-prefix-deduplication\\hostPrefixDeduplicationMiddleware.d.ts';
		const after = 'resources\\app\\extensions\\positron-catalog-explorer\\node_modules\\@azure\\msal-browser\\dist\\custom-auth-path\\custom_auth\\core\\auth_flow\\jit\\result\\AuthMethodRegistrationChallengeMethodResult.mjs';

		assert.deepStrictEqual(
			{
				before: { length: before.length, fits: before.length <= MAX_RELATIVE_PATH_LENGTH },
				after: { length: after.length, fits: after.length <= MAX_RELATIVE_PATH_LENGTH },
				beforeIsPruned: isPruned(before.slice('resources\\app\\extensions\\positron-data-driver-snowflake\\'.length)),
			},
			{
				before: { length: 210, fits: false },
				after: { length: 191, fits: true },
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
			];

			assert.deepStrictEqual(paths.map(isPruned), [
				true, true, true, true, true,
				false, false, false, false, false,
				false,
				false, false,
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
});
