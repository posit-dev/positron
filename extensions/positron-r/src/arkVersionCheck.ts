/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { LOGGER } from './extension';
import { EXTENSION_ROOT_DIR } from './constants';

/**
 * Whether the Ark version-mismatch warning has been shown this session. The
 * warning is informational and easily ignored, so we surface it at most once
 * per Positron session (mirroring the kernel supervisor's version warning).
 */
let hasWarnedArkVersionMismatch = false;

/** Path to the `ark` submodule checkout inside the extension (dev builds only). */
const arkSubmoduleDir = path.join(EXTENSION_ROOT_DIR, 'ark');

/**
 * Sidecar file written by `install-kernel` alongside the resolved Ark binary,
 * containing the submodule commit the install was resolved against. It ships in
 * the packaged extension (`resources/ark/` is bundled), so the expected commit
 * is available at runtime even in a release build where the git submodule is
 * absent.
 */
const submoduleCommitFile = path.join(EXTENSION_ROOT_DIR, 'resources', 'ark', 'SUBMODULE_COMMIT');

/**
 * Timeout for the git calls. These are local, fast operations, but the check
 * runs synchronously on the session-start path, so we cap it defensively rather
 * than risk blocking startup if git hangs.
 */
const GIT_TIMEOUT_MS = 5_000;

/** The expected Ark commit and where we learned it. */
interface ExpectedCommit {
	/** The commit the source tree pins (full hash from git, short hash from the sidecar). */
	readonly commit: string;
	/**
	 * `git` when read live from the submodule (dev), `sidecar` when read from the
	 * bundled marker (release). Governs whether the local-development suppression
	 * (which needs git) applies.
	 */
	readonly source: 'git' | 'sidecar';
}

/**
 * Warns (once per session) when the running Ark kernel was built from a
 * different commit than the one Positron expects.
 *
 * This signals that the installed Ark is stale relative to the source tree (for
 * example, `install-kernel` fell back to an older prebuild because rust wasn't
 * available to build the exact commit). The expected commit comes from the git
 * submodule in a dev build, or from the bundled `SUBMODULE_COMMIT` sidecar in a
 * release build. It is deliberately quiet when a mismatch is expected or
 * unknowable:
 *
 * - The running Ark doesn't report a commit (older Ark, or a build without git
 *   metadata) -> nothing to compare against.
 * - Neither the submodule nor the sidecar is available -> no expected commit.
 * - The submodule HEAD has commits beyond Ark's `origin/main` (dev only), which
 *   means the developer is doing local Ark development and already knows their
 *   Ark differs -> don't nag them.
 *
 * Any failure to determine the expected commit is treated as "can't tell" and
 * stays silent rather than showing a spurious warning.
 *
 * @param runtimeInfo The runtime info returned by the Ark kernel on start.
 */
export function warnOnArkVersionMismatch(runtimeInfo: positron.LanguageRuntimeInfo): void {
	if (hasWarnedArkVersionMismatch) {
		return;
	}

	// The commit the running Ark was built from. Absent on older Ark builds
	// that predate this field, in which case there's nothing to compare.
	const runningCommit = runtimeInfo.commit;
	if (!runningCommit) {
		return;
	}

	const expected = readExpectedCommit();
	if (!expected) {
		return;
	}

	// Compare by prefix: the running and sidecar commits are short hashes, a
	// git-read submodule HEAD is a full hash.
	if (expected.commit.startsWith(runningCommit) || runningCommit.startsWith(expected.commit)) {
		return;
	}

	// The commits differ. In a dev build, only warn when the submodule HEAD is a
	// released commit (an ancestor of Ark's origin/main); if it has local commits
	// on top, the developer is iterating on Ark and expects a mismatch. This
	// suppression needs git, so it only applies when the expected commit came
	// from the submodule; a release bundle has no local Ark development to guard.
	if (expected.source === 'git' && !isSubmoduleAncestorOfMain()) {
		LOGGER.debug(
			`Ark version check: running commit ${runningCommit} differs from submodule ` +
			`HEAD ${expected.commit.slice(0, 7)}, but HEAD looks like local Ark development; ` +
			`not warning.`);
		return;
	}

	hasWarnedArkVersionMismatch = true;
	const running = runtimeInfo.build_version ?? runningCommit;
	LOGGER.warn(
		`Running Ark (${running}, commit ${runningCommit}) does not match the expected commit ` +
		`${expected.commit.slice(0, 7)} (from ${expected.source}).`);
	vscode.window.showWarningMessage(vscode.l10n.t(
		'The running Ark R kernel ({0}) was built from a different commit ({1}) than the one ' +
		'Positron expects ({2}). R sessions should still work, but to run the pinned Ark, ' +
		'reinstall it by running `npm install` (building it from source requires the Rust toolchain).',
		running,
		runningCommit,
		expected.commit.slice(0, 7)));
}

/**
 * Determine the commit Positron expects Ark to have been built from. Prefers the
 * live submodule HEAD (dev builds, most accurate), falling back to the bundled
 * `SUBMODULE_COMMIT` sidecar (release builds). Returns undefined when neither is
 * available.
 */
function readExpectedCommit(): ExpectedCommit | undefined {
	// Dev build: the live submodule HEAD is authoritative.
	if (fs.existsSync(path.join(arkSubmoduleDir, '.git'))) {
		try {
			return { commit: git(['rev-parse', 'HEAD']), source: 'git' };
		} catch (err) {
			LOGGER.debug(`Ark version check: could not read submodule HEAD: ${err}`);
			// Fall through to the sidecar.
		}
	}

	// Release build (or git unavailable): the sidecar written at install time.
	try {
		const sidecar = fs.readFileSync(submoduleCommitFile, 'utf8').trim();
		if (sidecar) {
			return { commit: sidecar, source: 'sidecar' };
		}
	} catch {
		// No sidecar present.
	}

	return undefined;
}

/**
 * Whether the submodule HEAD is an ancestor of Ark's `origin/main` (i.e. it has
 * no local commits on top). Returns false on any git error so an unknowable
 * state stays silent.
 */
function isSubmoduleAncestorOfMain(): boolean {
	try {
		// Exits 0 when HEAD is an ancestor of origin/main, 1 otherwise.
		execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], {
			cwd: arkSubmoduleDir,
			stdio: 'ignore',
			timeout: GIT_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

/** Run a git command in the submodule and return its trimmed stdout. */
function git(args: string[]): string {
	return execFileSync('git', args, {
		cwd: arkSubmoduleDir,
		encoding: 'utf8',
		timeout: GIT_TIMEOUT_MS,
	}).trim();
}
