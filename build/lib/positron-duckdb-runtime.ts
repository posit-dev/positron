/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';

/**
 * The shared DuckDB runtime of the packaged build.
 *
 * Three extensions load DuckDB (`@duckdb/node-api`) from a forked worker. Each
 * one installs its own copy, so that a dev build and the per-folder `--cpu` rule
 * in build/npm/postinstall.ts keep working. Each copy carries a native library of
 * about 110 MB, so the packaged build ships one shared copy instead. It leaves the
 * per-extension copies out, and stages the copy of `DUCKDB_SOURCE_EXTENSION` in
 * the shared `extensions/node_modules`. Node resolution from the
 * `dist/duckdbWorker.js` of each extension finds it there.
 *
 * If the shared copy is incomplete, the worker cannot load DuckDB and exits. The
 * extension host then reports a crash for every query, and the PR e2e tests do
 * not see it, because they run from source. `checkSharedDuckdbRuntime` therefore
 * checks the packaged tree. See posit-dev/positron#14265.
 */

/** The extensions that share the DuckDB runtime. */
export const DUCKDB_EXTENSIONS: ReadonlySet<string> = new Set([
	'positron-duckdb',
	'positron-data-driver-duckdb',
	'positron-data-driver-pins',
]);

/** The extension whose installed copy the build stages. */
export const DUCKDB_SOURCE_EXTENSION = 'positron-duckdb';

/**
 * The packages that make up the DuckDB runtime. `detect-libc` is a runtime
 * dependency of `@duckdb/node-bindings` only.
 */
export const DUCKDB_RUNTIME_PACKAGES: readonly string[] = ['@duckdb', 'detect-libc'];

/** The packages whose versions must match, because one copy serves every extension. */
const VERSIONED_PACKAGES = ['@duckdb/node-api', '@duckdb/node-bindings'];

const BINDINGS_PREFIX = 'node-bindings-';

/**
 * Whether a file of a DuckDB extension belongs to the shared runtime, and so
 * must not ship inside the extension. `relativePath` is relative to the
 * extension directory, with either separator.
 */
export function isDuckdbRuntimeFile(relativePath: string): boolean {
	const normalizedPath = relativePath.split(/[\\/]/).join('/');
	return DUCKDB_RUNTIME_PACKAGES.some(pkg => normalizedPath.startsWith(`node_modules/${pkg}/`));
}

function readVersion(nodeModulesDir: string, pkg: string): string | undefined {
	const manifestPath = path.join(nodeModulesDir, pkg, 'package.json');
	return fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version : undefined;
}

/**
 * Throws unless every extension in `DUCKDB_EXTENSIONS` has installed the same
 * versions of the DuckDB packages. `extensionsRoot` is the source `extensions/`
 * directory.
 */
export function assertDuckdbVersionsMatch(extensionsRoot: string): void {
	for (const pkg of VERSIONED_PACKAGES) {
		const versions = [...DUCKDB_EXTENSIONS].map(extensionName => ({
			extensionName,
			version: readVersion(path.join(extensionsRoot, extensionName, 'node_modules'), pkg)
		}));

		if (versions.some(v => v.version === undefined) || new Set(versions.map(v => v.version)).size !== 1) {
			const details = versions.map(v => `${v.extensionName}: ${v.version ?? 'not installed'}`).join(', ');
			throw new Error(`The extensions that share DuckDB must install the same version of ${pkg} (${details}). `
				+ 'Pin the same exact version in each package.json and run npm install.');
		}
	}
}

/**
 * The name of the DuckDB binding package that a build target loads, or
 * undefined when DuckDB publishes no binding for the target. The platform and
 * arch are the names of the gulp build targets. Alpine is a musl target, either
 * as the platform or, in the legacy `linux-alpine` target, as the arch.
 */
export function duckdbBindingPackage(platform: string, arch: string): string | undefined {
	if (arch === 'alpine') {
		return `@duckdb/${BINDINGS_PREFIX}linux-x64-musl`;
	}
	if (arch !== 'x64' && arch !== 'arm64') {
		return undefined;
	}
	switch (platform) {
		case 'alpine':
			return `@duckdb/${BINDINGS_PREFIX}linux-${arch}-musl`;
		case 'darwin':
		case 'linux':
		case 'win32':
			return `@duckdb/${BINDINGS_PREFIX}${platform}-${arch}`;
		default:
			return undefined;
	}
}

/** `node-bindings-linux-x64-musl` -> `linux-x64`. */
function platformArchOf(bindingDir: string): string {
	return bindingDir.slice(BINDINGS_PREFIX.length).replace(/-musl$/, '');
}

/** Whether `dependency` resolves from the package in `packageDir`, inside `nodeModulesDir`. */
function resolves(nodeModulesDir: string, packageDir: string, dependency: string): boolean {
	return fs.existsSync(path.join(packageDir, 'node_modules', dependency, 'package.json'))
		|| fs.existsSync(path.join(nodeModulesDir, dependency, 'package.json'));
}

/**
 * Checks the shared DuckDB runtime of a packaged tree, and returns a message for
 * each problem. `extensionsDir` is the packaged `extensions/` directory. When the
 * tree ships none of the DuckDB extensions, there is nothing to check.
 *
 * The check fails when:
 * - a DuckDB extension ships its own copy of the runtime
 * - the shared copy of `@duckdb/node-api` or `@duckdb/node-bindings` is missing
 * - the native binding for the target is missing, or a binding for a different
 *   platform or arch ships instead (a cross-build that staged the host binding)
 * - a runtime dependency of the shared packages does not resolve inside the
 *   shared `node_modules` (a new dependency after a DuckDB upgrade)
 *
 * A glibc and a musl binding for the same platform and arch do not count as a
 * mismatch. npm picks between them with the `libc` field, and an older npm can
 * install both.
 */
export function checkSharedDuckdbRuntime(extensionsDir: string, platform: string, arch: string): string[] {
	const shipped = [...DUCKDB_EXTENSIONS].filter(name => fs.existsSync(path.join(extensionsDir, name, 'package.json')));
	if (shipped.length === 0) {
		return [];
	}

	const problems: string[] = [];
	const nodeModulesDir = path.join(extensionsDir, 'node_modules');

	for (const extensionName of shipped) {
		for (const pkg of DUCKDB_RUNTIME_PACKAGES) {
			if (fs.existsSync(path.join(extensionsDir, extensionName, 'node_modules', pkg))) {
				problems.push(`${extensionName} ships its own node_modules/${pkg}, which must come from the shared node_modules`);
			}
		}
	}

	const packages = [...VERSIONED_PACKAGES];
	for (const pkg of VERSIONED_PACKAGES) {
		if (readVersion(nodeModulesDir, pkg) === undefined) {
			problems.push(`node_modules/${pkg} is missing`);
		}
	}

	const binding = duckdbBindingPackage(platform, arch);
	if (binding) {
		if (fs.existsSync(path.join(nodeModulesDir, binding, 'duckdb.node'))) {
			packages.push(binding);
		} else {
			problems.push(`node_modules/${binding}/duckdb.node is missing`);
		}

		const expected = platformArchOf(path.basename(binding));
		const duckdbScope = path.join(nodeModulesDir, '@duckdb');
		const bindingDirs = fs.existsSync(duckdbScope) ? fs.readdirSync(duckdbScope).filter(dir => dir.startsWith(BINDINGS_PREFIX)) : [];
		for (const dir of bindingDirs) {
			if (platformArchOf(dir) !== expected) {
				problems.push(`node_modules/@duckdb/${dir} does not match the ${platform}-${arch} target`);
			}
		}
	}

	for (const pkg of packages) {
		const packageDir = path.join(nodeModulesDir, pkg);
		const manifestPath = path.join(packageDir, 'package.json');
		if (!fs.existsSync(manifestPath)) {
			continue;
		}
		const dependencies = Object.keys(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).dependencies ?? {});
		for (const dependency of dependencies) {
			if (!resolves(nodeModulesDir, packageDir, dependency)) {
				problems.push(`${pkg} depends on ${dependency}, which is not in the shared node_modules. `
					+ 'Add it to DUCKDB_RUNTIME_PACKAGES');
			}
		}
	}

	return problems;
}
