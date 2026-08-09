/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import minimatch from 'minimatch';

/**
 * Windows MAX_PATH budget for the packaged application tree.
 *
 * Windows limits a path to MAX_PATH (260) characters. This limit counts the
 * terminating null, so the longest usable path is 259 characters. Inno Setup 6.4
 * is not long-path aware, because the installer manifest has no `longPathAware`
 * element. As a result, the `LongPathsEnabled` registry setting does not raise
 * this limit for an install or an update.
 *
 * A shipped file with a path over the budget does not install. The user gets a
 * per-file error that they can skip. The install or the auto-update is then
 * incomplete.
 *
 * The budget is what remains after the install prefix and the account name of
 * the user. Therefore it applies to a path relative to the install directory.
 * This module measures a path as `resources\app\extensions\...`, which is what
 * Inno Setup writes inside `C:\Users\<user>\AppData\Local\Programs\Positron\`.
 *
 * See https://github.com/posit-dev/positron/issues/14702.
 */

/** Longest usable Windows path. MAX_PATH is 260 and counts the terminating null. */
const MAX_USABLE_PATH = 259;

/**
 * `C:\Users\<user>\AppData\Local\Programs\Positron\` without the account name.
 * This per-user location is the default, and it is the one that fails. A system
 * install inside `C:\Program Files\Positron\` is 16 characters shorter.
 */
const USER_INSTALL_PREFIX = 42;

/**
 * A background update writes the new tree to `{app}\_`, then moves it into place.
 * See `GetDestDir()` in build/win32/positron.iss. Every path is therefore 2
 * characters longer during an update than during a fresh install. The budget uses
 * the update, because a budget for the install alone breaks auto-update for users
 * whose install worked.
 */
const BACKGROUND_UPDATE_SUFFIX = 2;

/**
 * Longest Windows account name that a per-user install and auto-update must
 * support. Domain accounts of the form `firstname.lastname` often reach 18
 * characters or more.
 */
const ACCOUNT_NAME_ALLOWANCE = 20;

/**
 * Longest path, relative to the install directory, that a shipped file can have.
 * The value is 195.
 */
export const MAX_RELATIVE_PATH_LENGTH =
	MAX_USABLE_PATH - USER_INSTALL_PREFIX - BACKGROUND_UPDATE_SUFFIX - ACCOUNT_NAME_ALLOWANCE;

/** Explains the budget in a build log, so that a failure describes itself. */
export function describeBudget(): string {
	return `${MAX_USABLE_PATH} usable - ${USER_INSTALL_PREFIX} install prefix`
		+ ` - ${BACKGROUND_UPDATE_SUFFIX} background-update suffix`
		+ ` - ${ACCOUNT_NAME_ALLOWANCE} account name = ${MAX_RELATIVE_PATH_LENGTH}`;
}

/**
 * Glob patterns for the files that reach the packaged tree but that no code loads
 * at runtime. Each pattern matches a path relative to an extension directory.
 *
 * `isPrunedExtensionDependencyFile` applies these patterns. Use that function
 * instead of the patterns, so that the packaging code and the tests normalize and
 * match a path in the same way.
 *
 * These patterns match only inside `node_modules`. The extensions in
 * `extensionsWithNpmDeps` (build/lib/extensions.ts) ship their production
 * dependencies without change, and most of them have no `.vscodeignore`. As a
 * result, the type declarations that npm packages ship with their JavaScript go
 * into the app. These declarations own the longest paths in the tree, because
 * `@aws-sdk/*` publishes a `dist-types/ts3.4/` variant.
 *
 * `build/.moduleignore` already removes `**\/*.ts` from the shared and Copilot
 * dependency streams. But `cleanNodeModules` never ran over the per-extension
 * dependencies that vsce collects, so these extensions never got that treatment.
 *
 * Only the bundled extensions use these patterns. The extensions that go through
 * `fromLocalNormal` do not. To use them there, you must add the exception that
 * `.moduleignore` already carries for `typescript/lib/lib*.d.ts`, which the
 * TypeScript language service loads at runtime.
 */
const EXTENSION_NODE_MODULES_EXCLUDES = [
	// TypeScript declarations and sources. Node never loads these files. The
	// build compiles and bundles each extension before packaging. These patterns
	// also clear the `dist-types` trees, where every file is a declaration or a
	// declaration map.
	'node_modules/**/*.ts',
	'node_modules/**/*.tsx',
	'node_modules/**/*.d.ts.map',
	// The ESM twins of `dist-cjs` in the AWS and Smithy SDKs. `@aws-sdk/*` and
	// `@smithy/*` resolve `main` and the `node` export condition to `dist-cjs`.
	// The only consumer is `snowflake-sdk`, which stays external to the esbuild
	// bundle and therefore loads as CommonJS. These patterns name the two package
	// scopes, because many other packages ship `dist-es` as their only build.
	'node_modules/@aws-sdk/**/dist-es/**',
	'node_modules/@smithy/**/dist-es/**',
];

/**
 * Whether the package must leave out a file of a bundled extension, because no
 * code loads that file at runtime.
 *
 * `relativePath` is relative to the extension directory. The function accepts
 * both separators, because vsce reports native ones and the patterns use forward
 * slashes.
 *
 * The packaging code and the tests share this one function. Two separate uses of
 * the patterns can drift apart. A change to the normalization of a path, or to
 * the match options, then goes unnoticed.
 *
 * No unit test covers the call site in `fromLocalEsbuild`, because a test must
 * drive vsce and a gulp stream to reach it. `positron-check-path-lengths.ts`
 * covers it instead. If the prune stops, the longest shipped path returns to 210
 * characters and packaging fails.
 */
export function isPrunedExtensionDependencyFile(relativePath: string): boolean {
	const normalizedPath = relativePath.split(/[\\/]/).join('/');

	return EXTENSION_NODE_MODULES_EXCLUDES.some(
		pattern => minimatch(normalizedPath, pattern, { dot: true }));
}

/**
 * The `@opentelemetry/*` packages that the Copilot extension needs at runtime.
 *
 * The extension bundles OpenTelemetry into `dist/extension.js`. It keeps
 * `@opentelemetry/instrumentation` external, as the `external` list in
 * extensions/copilot/.esbuild.mts shows. That package and its dependency closure
 * must therefore ship.
 *
 * The other 17 `@opentelemetry/*` packages in the production dependencies are
 * already inside the bundle, so the copies in `node_modules` are dead weight.
 * They are also deep. Each OTLP exporter carries its own nested
 * `@opentelemetry/resources`, which is the source of the paths in the original
 * report.
 */
export const COPILOT_RUNTIME_OPENTELEMETRY_PACKAGES = new Set([
	'api',
	'core',
	'instrumentation',
]);

/**
 * Whether a resolved production-dependency directory is an `@opentelemetry`
 * package that the Copilot extension does not need at runtime.
 *
 * The function examines every `@opentelemetry/` segment, not only the last one.
 * The build therefore removes a nested copy together with its parent package. An
 * example is
 * `@opentelemetry/exporter-trace-otlp-grpc/node_modules/@opentelemetry/core`.
 * Without this rule, the glob of the parent returns that copy to the package.
 */
export function isUnusedCopilotOpenTelemetryPackage(dependencyPath: string): boolean {
	const segments = dependencyPath.split(/[\\/]/);

	for (let i = 0; i < segments.length - 1; i++) {
		if (segments[i] === '@opentelemetry'
			&& !COPILOT_RUNTIME_OPENTELEMETRY_PACKAGES.has(segments[i + 1])) {
			return true;
		}
	}

	return false;
}
