/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which ark the build under test bundles, so a step on the dashboard's `kernel`
 * band or on Performance Trends can be attributed to an ark bump rather than
 * read as a regression. Ark is not captured anywhere in the dashboard today.
 *
 * Shared by both pipelines -- the memory payload and the performance client --
 * rather than living under `memory/`, so the two cannot start reporting
 * different ark versions for the same run.
 *
 * Read from the build's own files rather than from the running kernel.
 * `runtimeInfo.build_version` (what `arkVersionCheck.ts` compares against) only
 * exists inside the extension host and is unreachable from the harness, and
 * asking the kernel would leave the scenarios that never start a session --
 * `idle`, `data-explorer`, `editors` -- unable to report anything.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where positron-r keeps its ark sidecars inside an extracted build, most
 * likely first.
 *
 * Mirrors `getVersionFromBuild` in `infra/test-runner/positron-version.ts`: the
 * desktop packagings differ by platform, and a positron-server build keeps its
 * app files at the root rather than under `resources/app`. A candidate list
 * rather than a branch on the memory lane, because the question here is only
 * where this build put its extensions.
 */
export function arkResourceDirs(buildRoot: string, platform: NodeJS.Platform = process.platform): string[] {
	const extensionDir = join('extensions', 'positron-r', 'resources', 'ark');
	const appDir = platform === 'darwin'
		? join('Contents', 'Resources', 'app')
		: join('resources', 'app');
	return [join(buildRoot, appDir, extensionDir), join(buildRoot, extensionDir)];
}

/**
 * The sidecars `extensions/positron-r/scripts/install-kernel.ts` writes beside
 * the installed ark binary, in preference order. Both ship in the packaged
 * extension: `.vscodeignore` excludes the `ark/**` submodule but not
 * `resources/ark/**`.
 *
 * `VERSION` holds the resolved build version, `0.1.252+209.885fac4`, which is
 * `${Cargo version}+${commits since the tag}.${short sha}` and the same string
 * the running kernel reports as `runtimeInfo.build_version`.
 *
 * `SUBMODULE_COMMIT` holds the short sha alone, and is the fallback rather than
 * the primary because of an asymmetry in how the two are written: `main()`
 * writes the commit up front on every resolution path, while `VERSION` is
 * written only after a prebuild download, so a locally built ark leaves the
 * commit and no version.
 */
const ARK_SIDECARS = ['VERSION', 'SUBMODULE_COMMIT'] as const;

/**
 * The ark version this build bundles, or `undefined` when it cannot be
 * determined.
 *
 * Never returns a placeholder and never throws. A literal `'unknown'` reaching
 * the dashboard would draw an ark marker on a date where no release happened,
 * and by the time this is called a memory run has already measured everything --
 * failing here would cost the measurement to gain nothing.
 */
export function readArkVersion(buildRoot: string = process.env.BUILD || process.cwd()): string | undefined {
	// `BUILD` is only set on the memory lane plus two hardcoded remote lanes
	// (test-memory-metrics.yml), but the performance client decides prod vs.
	// local by branch, not by `BUILD` (api.ts) -- so the nightly full suite that
	// produces every performance row has no `BUILD` and would never resolve an
	// ark version without a further fallback. That fallback is the checkout
	// itself: `process.cwd()` is this repo's own existing convention (see
	// `ROOT_PATH` in fixtures/test-setup/constants.ts), not a guess derived from
	// `__dirname`, and `arkResourceDirs`'s build-root candidate already resolves
	// a plain dev checkout's layout with no changes needed here. An explicit
	// empty string (as opposed to an omitted argument) still short-circuits
	// below, since a default parameter only applies to `undefined`.
	if (!buildRoot) {
		return undefined;
	}

	const dirs = arkResourceDirs(buildRoot);
	for (const dir of dirs) {
		for (const sidecar of ARK_SIDECARS) {
			const path = join(dir, sidecar);
			try {
				if (!existsSync(path)) {
					continue;
				}
				const value = readFileSync(path, 'utf8').trim();
				if (value) {
					return value;
				}
			} catch {
				// Unreadable sidecar: keep looking, and fall through to `undefined`.
			}
		}
	}

	return undefined;
}
