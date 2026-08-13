/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from 'child_process';
import * as fs from 'fs';
import path from 'path';

const SUBMODULE_PATH = 'ai-lib';

/**
 * Initialize the ai-lib submodule, tolerating a submodule directory that npm has
 * already populated.
 *
 * `git submodule update --init` clones into the submodule path, and git refuses to
 * clone into a directory that is not empty. That is exactly the state a fresh clone
 * is in by the time this runs: the root package.json declares `file:` dependencies
 * on the ai-lib workspace packages, and because those packages' devDependencies all
 * conflict with the root's (typescript, vitest, @types/node, zod), package-lock.json
 * records them nested at `ai-lib/packages/<pkg>/node_modules/...`. npm materializes
 * those paths during reify -- which happens BEFORE any lifecycle script, `preinstall`
 * included -- so the very first `npm install` after a clone creates `ai-lib/packages`
 * and then fails here with:
 *
 *     fatal: destination path '.../ai-lib' already exists and is not an empty directory.
 *
 * and it fails the same way on every subsequent run, because nothing ever clears the
 * directory. Moving the init earlier cannot fix this; the init has to cope with the
 * directory already existing. So: move the pre-existing entries aside, let git clone
 * into the now-empty path, then merge them back over the checkout.
 *
 * This is deliberately specific to ai-lib rather than a general submodule helper.
 * Moving a submodule's contents aside is only safe because everything that can be
 * there is npm-generated and reproducible -- for a submodule with a real working
 * tree (ark), the right answer to "not empty" is to fail loudly instead.
 *
 * @param root Absolute path to the repository root.
 * @param log Logger for progress messages.
 */
export function initAiLibSubmodule(root: string, log: (message: string) => void): void {
	const submoduleAbs = path.join(root, SUBMODULE_PATH);
	if (fs.existsSync(path.join(submoduleAbs, '.git'))) {
		return;
	}

	// Stash inside .build (gitignored, and on the same filesystem as the submodule
	// so the moves are renames rather than copies of a full node_modules tree).
	const stashDir = path.join(root, '.build', `${SUBMODULE_PATH}-init-stash`);
	const stray = fs.existsSync(submoduleAbs) ? fs.readdirSync(submoduleAbs) : [];

	if (stray.length) {
		log(`Submodule directory is not empty (${stray.join(', ')}); moving contents aside so git can clone into it...`);
		fs.rmSync(stashDir, { recursive: true, force: true });
		fs.mkdirSync(stashDir, { recursive: true });
		for (const entry of stray) {
			fs.renameSync(path.join(submoduleAbs, entry), path.join(stashDir, entry));
		}
	}

	try {
		log('Submodule not initialized; running `git submodule update --init`...');
		const result = child_process.spawnSync('git', ['submodule', 'update', '--init', '--', SUBMODULE_PATH], {
			cwd: root,
			stdio: 'inherit',
		});
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			throw new Error(`\`git submodule update --init -- ${SUBMODULE_PATH}\` exited with code ${result.status}`);
		}
	} finally {
		// Restore on failure too (e.g. offline): the stash holds the only copy of
		// whatever was there, and a half-installed node_modules still beats none.
		if (stray.length) {
			mergeInto(stashDir, submoduleAbs);
			fs.rmSync(stashDir, { recursive: true, force: true });
		}
	}
}

/**
 * Move everything under `from` into `to`, recursing into directories that exist on
 * both sides. Entries already present in `to` are left alone -- the checkout is the
 * source of truth for anything git tracks, and in practice the two do not overlap
 * at all, since the stash only ever holds npm-generated `node_modules` trees.
 */
function mergeInto(from: string, to: string): void {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from)) {
		const src = path.join(from, entry);
		const dest = path.join(to, entry);
		// lstat, not stat: node_modules is full of symlinks, and a symlink should be
		// moved as-is rather than descended into. throwIfNoEntry:false also treats a
		// dangling symlink at dest as "present" so the rename below cannot EEXIST.
		const destStat = fs.lstatSync(dest, { throwIfNoEntry: false });
		if (!destStat) {
			fs.renameSync(src, dest);
		} else if (destStat.isDirectory() && fs.lstatSync(src).isDirectory()) {
			mergeInto(src, dest);
		}
	}
}
