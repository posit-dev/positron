/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Lists the direct dependencies that `npm audit fix --package-lock-only`
// changed in a project's package-lock.json, for scripts/dependency-audit.sh.
// A direct bump can change behavior more than a transitive patch, so these
// deserve a closer review. (The script checks that the new lockfile satisfies
// the declared ranges with `npm ci --dry-run`, not here.)
//
// Usage: node scripts/dependency-audit-lockcheck.mts <before.json> <after.json>
//
// Prints JSON on stdout:
//   { "directChanges": ["snowflake-sdk 3.1.0 -> 3.4.0 (minor)", ...] }

import { readFileSync } from 'node:fs';

/** One entry of a package-lock.json "packages" map. */
interface LockEntry {
	version?: string;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

/** The parts of a package-lock.json that this script reads. */
interface Lockfile {
	packages?: Record<string, LockEntry>;
}

/**
 * Name the part of the version that changed: "major", "minor", "patch", or
 * "prerelease" (same major.minor.patch). "changed" if either is not semver.
 */
function bumpKind(oldVersion: string, newVersion: string): string {
	const versionPattern = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/;
	const oldParts = versionPattern.exec(oldVersion)?.groups;
	const newParts = versionPattern.exec(newVersion)?.groups;
	if (!oldParts || !newParts) {
		return 'changed';
	}
	for (const part of ['major', 'minor', 'patch']) {
		if (oldParts[part] !== newParts[part]) {
			return part;
		}
	}
	return 'prerelease';
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
			changes.push(`${name} ${oldVersion} -> ${newVersion} (${bumpKind(oldVersion, newVersion)})`);
		}
	}
	return changes;
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
	console.error('Usage: node scripts/dependency-audit-lockcheck.mts <before.json> <after.json>');
	process.exit(2);
}
const before: Lockfile = JSON.parse(readFileSync(beforePath, 'utf8'));
const after: Lockfile = JSON.parse(readFileSync(afterPath, 'utf8'));

console.log(JSON.stringify({ directChanges: findDirectChanges(before, after) }));
