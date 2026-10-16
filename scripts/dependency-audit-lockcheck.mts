/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Compares a project's package-lock.json before and after `npm audit fix
// --package-lock-only`, for scripts/dependency-audit.sh.
//
// Usage: node scripts/dependency-audit-lockcheck.mts <before.json> <after.json> [package.json]
//
// Prints JSON on stdout:
//   {
//     "problems": ["snowflake-sdk@3.4.0 needs toml@^5.0.0, found 4.3.0", ...],
//     "directChanges": ["snowflake-sdk 3.1.0 -> 3.4.0 (minor)", ...]
//   }
//
// "problems" are dependency ranges that the new lockfile does not satisfy but
// the old one did. Neither `npm ls` nor `npm ci` reports these: the install
// just loads a version outside the declared range. Packages named in the
// project's `overrides` (from package.json) are skipped, because there a
// mismatch is deliberate (for example, forcing a patched version).
// "directChanges" are the project's own dependencies whose resolved version
// changed, which deserve a closer review than transitive bumps.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** The parts of the semver package that this script uses. */
interface Semver {
	valid(version: string): string | null;
	validRange(range: string): string | null;
	satisfies(version: string, range: string, options?: { includePrerelease?: boolean }): boolean;
	diff(a: string, b: string): string | null;
}

/** One entry of a package-lock.json "packages" map. */
interface LockEntry {
	version?: string;
	link?: boolean;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

/** The parts of a package-lock.json that this script reads. */
interface Lockfile {
	name?: string;
	packages?: Record<string, LockEntry>;
}

/** An npm `overrides` object: package name to version spec or nested overrides. */
interface Overrides {
	[name: string]: string | Overrides;
}

const semver = loadSemver();

/**
 * Load semver without a project install: prefer the repo's copy, else the copy
 * bundled with npm itself (always present where npm is).
 */
function loadSemver(): Semver {
	try {
		return createRequire(import.meta.url)('semver');
	} catch {
		const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
		return createRequire(path.join(npmRoot, 'npm', 'package.json'))('semver');
	}
}

/**
 * Find the lockfile entry that Node would load for `name` when required from
 * the package at `fromKey`: walk up the nested node_modules directories.
 */
function resolve(packages: Record<string, LockEntry>, fromKey: string, name: string): LockEntry | undefined {
	let dir = fromKey;
	for (;;) {
		const key = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
		if (packages[key]) {
			return packages[key];
		}
		if (!dir) {
			return undefined;
		}
		const index = dir.lastIndexOf('/node_modules/');
		dir = index === -1 ? '' : dir.slice(0, index);
		// A top-level package ("node_modules/foo") resolves from the project root.
		if (dir === 'node_modules') {
			dir = '';
		}
	}
}

/**
 * List every dependency range that the lockfile does not satisfy. Peer
 * dependencies are skipped: extensions install with legacy-peer-deps.
 */
function findProblems(lock: Lockfile, overridden: Set<string>): Set<string> {
	const packages = lock.packages ?? {};
	const problems = new Set<string>();
	for (const [key, entry] of Object.entries(packages)) {
		// Skip symlinks and linked local packages (keys like "../../ai-lib/..."),
		// which resolve their dependencies outside this lockfile.
		if (entry.link || (key !== '' && !key.startsWith('node_modules/'))) {
			continue;
		}
		const ranges: [string, string, boolean][] = [
			...Object.entries(entry.dependencies ?? {}).map(([n, r]): [string, string, boolean] => [n, r, false]),
			...Object.entries(entry.optionalDependencies ?? {}).map(([n, r]): [string, string, boolean] => [n, r, true]),
		];
		for (const [name, range, optional] of ranges) {
			// Skip git URLs, file: paths, npm: aliases, and other non-semver specs.
			if (overridden.has(name) || !semver.validRange(range)) {
				continue;
			}
			const target = resolve(packages, key, name);
			const owner = key === '' ? (lock.name ?? 'project') : `${key.split('node_modules/').pop()}@${entry.version}`;
			if (!target) {
				if (!optional) {
					problems.add(`${owner} needs ${name}@${range}, not in lockfile`);
				}
				continue;
			}
			if (target.version && !semver.satisfies(target.version, range, { includePrerelease: true })) {
				problems.add(`${owner} needs ${name}@${range}, found ${target.version}`);
			}
		}
	}
	return problems;
}

/**
 * Collect every package name in an npm `overrides` object, at any depth.
 * Nested keys ("odbc": { "node-addon-api": ... }) name both the parent and the
 * overridden child; skipping both is coarse but never flags a deliberate pin.
 */
function overriddenNames(overrides: Overrides | undefined, names = new Set<string>()): Set<string> {
	for (const [key, value] of Object.entries(overrides ?? {})) {
		// "pkg@1.x" -> "pkg"; "@scope/pkg" has no version suffix and is kept.
		names.add(key.replace(/@[^@/]*$/, '') || key);
		if (typeof value === 'object') {
			overriddenNames(value, names);
		}
	}
	return names;
}

/**
 * List the project's direct dependencies whose resolved version changed.
 */
function findDirectChanges(before: Lockfile, after: Lockfile): string[] {
	const root = after.packages?.[''] ?? {};
	const names = Object.keys({ ...root.dependencies, ...root.optionalDependencies, ...root.devDependencies });
	const changes: string[] = [];
	for (const name of names.sort()) {
		const oldVersion = before.packages?.[`node_modules/${name}`]?.version;
		const newVersion = after.packages?.[`node_modules/${name}`]?.version;
		if (oldVersion && newVersion && oldVersion !== newVersion) {
			const kind = semver.valid(oldVersion) && semver.valid(newVersion) ? semver.diff(oldVersion, newVersion) : 'changed';
			changes.push(`${name} ${oldVersion} -> ${newVersion} (${kind})`);
		}
	}
	return changes;
}

const [beforePath, afterPath, manifestPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
	console.error('Usage: node scripts/dependency-audit-lockcheck.mts <before.json> <after.json> [package.json]');
	process.exit(2);
}
const before: Lockfile = JSON.parse(readFileSync(beforePath, 'utf8'));
const after: Lockfile = JSON.parse(readFileSync(afterPath, 'utf8'));

const overridden = manifestPath ? overriddenNames(JSON.parse(readFileSync(manifestPath, 'utf8')).overrides) : new Set<string>();

const oldProblems = findProblems(before, overridden);
const problems = [...findProblems(after, overridden)].filter(problem => !oldProblems.has(problem));

console.log(JSON.stringify({ problems, directChanges: findDirectChanges(before, after) }));
