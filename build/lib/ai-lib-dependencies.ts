/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import es from 'event-stream';
import * as fs from 'fs';
import * as path from 'path';
import { gulp, rename } from './gulp/facade.ts';

const REPO_ROOT = fs.realpathSync(path.dirname(path.dirname(import.meta.dirname)));

/**
 * The ai-lib packages the server (REH) loads at runtime.
 *
 * `ai-config` backs the AI provider catalog and `ai-provider-bridge` backs the
 * headless language model engine; both are registered in `serverServices.ts`
 * and reach their package through a bare dynamic import (`ai-config/node`,
 * `ai-provider-bridge`), so the package has to exist in the server's
 * `node_modules` at runtime.
 *
 * They are consumed from the ai-lib submodule as `file:` dependencies of the
 * *root* package.json, which is why `getProductionDependencies('remote')` never
 * sees them: nothing under `remote/` depends on them. Without the explicit copy
 * below the imports fail with ERR_MODULE_NOT_FOUND on the remote host, which
 * silently empties the provider catalog (posit-dev/positron#15306) and disables
 * headless model egress.
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

/**
 * The production dependency closure of {@link AI_LIB_SERVER_PACKAGES}, as
 * repository-relative directories.
 *
 * Each dependency is resolved from the directory that declares it, so a version
 * npm had to nest (ai-config's zod 4 against the server's zod 3, the bridge's
 * `@github/copilot-sdk` 0.2 against the server's 1.x) is reported at its nested
 * path and keeps winning over the hoisted copy once shipped. Dev and peer
 * dependencies are not walked: the packages ship prebuilt `dist/` output, and
 * their only peer (`vscode`) comes from the host at runtime.
 */
export function getAiLibProductionDependencies(packageNames: string[] = AI_LIB_SERVER_PACKAGES): string[] {
	const resolved = new Set<string>();
	const queue: { name: string; fromDir: string; optional: boolean }[] =
		packageNames.map(name => ({ name, fromDir: REPO_ROOT, optional: false }));

	while (queue.length > 0) {
		const { name, fromDir, optional } = queue.shift()!;
		const moduleDir = findModuleDir(name, fromDir);
		if (!moduleDir) {
			if (optional) {
				continue;
			}
			throw new Error(`Cannot resolve ai-lib dependency '${name}' from ${fromDir}. Run 'npm install' first.`);
		}
		if (resolved.has(moduleDir)) {
			continue;
		}
		resolved.add(moduleDir);

		const manifest = readManifest(moduleDir);
		for (const dependency of Object.keys(manifest.dependencies ?? {})) {
			queue.push({ name: dependency, fromDir: moduleDir, optional: false });
		}
		for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
			queue.push({ name: dependency, fromDir: moduleDir, optional: true });
		}
	}

	return [...resolved].map(toRepoRelative).sort();
}

/**
 * Where a resolved dependency belongs in the server's `node_modules`. Packages
 * already installed under `node_modules/` keep their path; the ai-lib checkouts
 * (and anything nested inside them) move from `ai-lib/packages/` into
 * `node_modules/`, which is the layout the desktop app ships.
 */
export function toServerModulePath(repoRelativeDir: string): string {
	if (repoRelativeDir.startsWith('node_modules/')) {
		return repoRelativeDir;
	}
	if (repoRelativeDir.startsWith('ai-lib/packages/')) {
		return `node_modules/${repoRelativeDir.slice('ai-lib/packages/'.length)}`;
	}
	throw new Error(`Unexpected ai-lib dependency location: ${repoRelativeDir}`);
}

/**
 * Stream the ai-lib packages the server loads at runtime, plus their production
 * dependency closure, rewritten to the `node_modules/**` paths the server
 * resolves them from. Callers merge this alongside the `remote/` production
 * dependencies so both get the same filtering (`.moduleignore`, source maps).
 *
 * `alreadyShippedModulePaths` are the destinations the caller already packages
 * from `remote/package.json` (e.g. `node_modules/@github/copilot`); a shared
 * dependency is left to that copy rather than shipped twice, which also keeps
 * the target-platform copy of a per-platform package instead of the host's.
 * Nested `node_modules` are excluded per directory because the closure reports
 * every nested dependency as its own entry with its own destination.
 */
export function getAiLibServerDependencies(alreadyShippedModulePaths: Iterable<string> = []): NodeJS.ReadWriteStream {
	const alreadyShipped = new Set(alreadyShippedModulePaths);
	const streams = getAiLibProductionDependencies()
		.filter(dir => !alreadyShipped.has(toServerModulePath(dir)))
		.map(dir => {
			const destination = toServerModulePath(dir);
			return gulp.src([
				`${dir}/**`,
				`!${dir}/node_modules/**`,
				`!${dir}/**/{test,tests}/**`,
			], { cwd: REPO_ROOT, base: dir, dot: true })
				.pipe(rename(file => {
					file.dirname = path.join(destination, file.dirname ?? '');
				}));
		});

	return es.merge(streams);
}
