/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = fs.realpathSync(path.dirname(path.dirname(import.meta.dirname)));

/**
 * The ai-lib packages the server (REH) loads at runtime.
 *
 * `ai-config` backs the AI provider catalog and `ai-provider-bridge` backs the
 * headless language model engine; both are registered in `serverServices.ts`.
 * The engine reaches its package through a bare dynamic import
 * (`ai-provider-bridge/headless`), which in turn loads `ai-config/node`. The
 * server bundle includes `ai-config`, so only `ai-provider-bridge` ships in the
 * server's `node_modules`; this list seeds the closure that the bundle's notices
 * are cross-checked against.
 *
 * They are consumed from the ai-lib submodule as `file:` dependencies of the
 * *root* package.json, which is why `getProductionDependencies('remote')` never
 * sees them: nothing under `remote/` depends on them. The server build ships
 * them as one bundle instead (see ai-lib-server-bundle.ts). Without it, the
 * imports fail with ERR_MODULE_NOT_FOUND on the remote host, which silently
 * empties the provider catalog (posit-dev/positron#15306) and disables headless
 * model egress.
 */
export const AI_LIB_SERVER_PACKAGES = ['ai-config', 'ai-provider-bridge'];

interface PackageManifest {
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

function readManifest(moduleDir: string): PackageManifest {
	return JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8'));
}

/**
 * Resolve `name` the way Node will at runtime: walk `node_modules` upwards from
 * `fromDir`, stopping at the repository root. Returns the real (symlink-free)
 * directory, so a `file:` linked package resolves to its checkout under
 * `ai-lib/packages/`.
 */
function findModuleDir(name: string, fromDir: string): string | undefined {
	let dir = fromDir;

	while (true) {
		const candidate = path.join(dir, 'node_modules', name);
		if (fs.existsSync(path.join(candidate, 'package.json'))) {
			return fs.realpathSync(candidate);
		}
		if (dir === REPO_ROOT) {
			return undefined;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}

function toRepoRelative(moduleDir: string): string {
	const relative = path.relative(REPO_ROOT, moduleDir);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`ai-lib dependency resolved outside the repository: ${moduleDir}`);
	}
	return relative.split(path.sep).join('/');
}

/** A module in the closure: where it is installed, and where the server would load it from. */
export interface AiLibServerModule {
	/** Repository-relative directory of the installed module. */
	source: string;
	/** Path under the server root, always inside `node_modules/`. */
	destination: string;
}

/**
 * The production dependency closure of {@link AI_LIB_SERVER_PACKAGES}, as
 * source/destination pairs. The server ships a bundle, not these modules (see
 * ai-lib-server-bundle.ts); the bundle cross-checks its notices against this list.
 *
 * Each dependency is resolved from the directory that declares it, so a version
 * npm had to nest for a conflict is reported at its nested path. Dev and peer
 * dependencies are not walked: the packages ship prebuilt `dist/` output, and
 * their only peer (`vscode`) comes from the host at runtime.
 *
 * Pairs are keyed by destination, not source: a dependency hoisted to the
 * ai-lib checkout root belongs to each ai-lib package that requires it, and
 * lands once per package (see {@link toServerModulePath}).
 */
export function getAiLibServerModules(packageNames: string[] = AI_LIB_SERVER_PACKAGES): AiLibServerModule[] {
	const modules = new Map<string, string>();
	const queue: { name: string; fromDir: string; optional: boolean; owner: string }[] =
		packageNames.map(name => ({ name, fromDir: REPO_ROOT, optional: false, owner: name }));

	while (queue.length > 0) {
		const { name, fromDir, optional, owner } = queue.shift()!;
		const moduleDir = findModuleDir(name, fromDir);
		if (!moduleDir) {
			if (optional) {
				continue;
			}
			throw new Error(`Cannot resolve ai-lib dependency '${name}' from ${fromDir}. Run 'npm install' first.`);
		}

		const source = toRepoRelative(moduleDir);
		const destination = toServerModulePath(source, owner);
		if (modules.has(destination)) {
			continue;
		}
		modules.set(destination, source);

		const manifest = readManifest(moduleDir);
		for (const dependency of Object.keys(manifest.dependencies ?? {})) {
			queue.push({ name: dependency, fromDir: moduleDir, optional: false, owner });
		}
		for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
			queue.push({ name: dependency, fromDir: moduleDir, optional: true, owner });
		}
	}

	return [...modules]
		.map(([destination, source]) => ({ source, destination }))
		.sort((a, b) => a.destination.localeCompare(b.destination));
}

/**
 * Where a resolved dependency belongs in the server's `node_modules`, given the
 * ai-lib package (`owner`) whose closure reached it.
 *
 * Packages installed under the repository's own `node_modules/` keep their path;
 * the ai-lib checkouts (and anything nested inside them) move from
 * `ai-lib/packages/` into `node_modules/`, which is the layout the desktop app
 * ships.
 *
 * A dependency hoisted above the package checkouts (which happens once someone
 * runs `npm install` inside `ai-lib` to work on it, since Positron's own install
 * only populates the packages) has no counterpart in the server layout, where
 * the packages sit directly under `node_modules/`. It is placed under its owner
 * instead, so the closure lists it once per owner and the bundle's notices
 * cross-check finds it by package name. Everything below the hoist point keeps
 * its nesting, so a dependency npm nested for a version conflict stays distinct
 * from the copy it was nested against.
 */
export function toServerModulePath(repoRelativeDir: string, owner: string): string {
	if (repoRelativeDir.startsWith('node_modules/')) {
		return repoRelativeDir;
	}

	const packagesPrefix = 'ai-lib/packages/';
	if (repoRelativeDir.startsWith(packagesPrefix)) {
		const belowPackages = repoRelativeDir.slice(packagesPrefix.length);
		// `<pkg>` or `<pkg>/node_modules/<dep>`, the shape the server keeps verbatim.
		// A `node_modules/` first segment is instead a hoist to the packages dir.
		if (!belowPackages.startsWith('node_modules/')) {
			return `node_modules/${belowPackages}`;
		}
	}

	const marker = 'node_modules/';
	const hoistPoint = repoRelativeDir.indexOf(marker);
	if (repoRelativeDir.startsWith('ai-lib/') && hoistPoint !== -1) {
		return `node_modules/${owner}/node_modules/${repoRelativeDir.slice(hoistPoint + marker.length)}`;
	}

	throw new Error(`Unexpected ai-lib dependency location: ${repoRelativeDir}`);
}
