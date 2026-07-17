/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LOGGER } from './extension';
import { EXTENSION_ROOT_DIR } from './constants';

const execFileAsync = promisify(execFile);

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
 * Timeout for the git calls. These are local, fast operations, and the check
 * runs asynchronously off the session-start path, but we cap them defensively
 * rather than risk leaving a git process hanging around.
 */
const GIT_TIMEOUT_MS = 5_000;

/** Configuration section the Ark kernel settings live under. */
const CONFIG_SECTION = 'positron.r';

/** Setting controlling whether the version-mismatch warning is shown. */
const WARN_ON_MISMATCH_SETTING = 'kernel.warnOnVersionMismatch';

/** Setting holding a user-provided override path to the Ark kernel. */
const KERNEL_PATH_SETTING = 'kernel.path';

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
 * The check can be turned off via the `positron.r.kernel.warnOnVersionMismatch`
 * setting. When the user has set a custom `positron.r.kernel.path`, the warning
 * names that path and points at the kernel path setting instead (and skips the
 * local-development suppression, since the binary was chosen explicitly).
 *
 * Runs asynchronously and is invoked fire-and-forget from the session-start
 * path, so the git subprocesses it may spawn never slow down boot.
 *
 * @param runtimeInfo The runtime info returned by the Ark kernel on start.
 */
export async function warnOnArkVersionMismatch(runtimeInfo: positron.LanguageRuntimeInfo): Promise<void> {
	if (hasWarnedArkVersionMismatch) {
		return;
	}

	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

	// Respect the opt-out. Defaults to true, so an unset value still warns.
	if (config.get<boolean>(WARN_ON_MISMATCH_SETTING) === false) {
		return;
	}

	// The commit the running Ark was built from. Absent on older Ark builds
	// that predate this field, in which case there's nothing to compare.
	const runningCommit = runtimeInfo.commit;
	if (!runningCommit) {
		return;
	}

	const expected = await readExpectedCommit();
	if (!expected) {
		return;
	}

	// Compare by prefix: the running and sidecar commits are short hashes, a
	// git-read submodule HEAD is a full hash.
	if (expected.commit.startsWith(runningCommit) || runningCommit.startsWith(expected.commit)) {
		return;
	}

	// A non-empty kernel path setting means the user has explicitly pointed
	// Positron at an Ark binary of their choosing. A mismatch there is worth
	// surfacing regardless of local Ark development, and the fix is to correct
	// that setting rather than to reinstall.
	const customKernelPath = config.get<string>(KERNEL_PATH_SETTING)?.trim() || undefined;

	// The commits differ. In a dev build with no custom kernel path, only warn
	// when the submodule HEAD is a released commit (an ancestor of Ark's
	// origin/main); if it has local commits on top, the developer is iterating
	// on Ark and expects a mismatch. This suppression needs git, so it only
	// applies when the expected commit came from the submodule; a release bundle
	// has no local Ark development to guard.
	if (!customKernelPath && expected.source === 'git' && !(await isSubmoduleAncestorOfMain())) {
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
		`${expected.commit.slice(0, 7)} (from ${expected.source})` +
		(customKernelPath ? `; kernel path override is set to ${customKernelPath}.` : '.'));

	// Fire-and-forget: showing the toast and reacting to a button press is
	// asynchronous, but the caller doesn't need to wait on it.
	void showMismatchWarning(running, runningCommit, expected.commit.slice(0, 7), customKernelPath);
}

/**
 * Shows the version-mismatch warning toast and handles its buttons.
 *
 * When a custom kernel path is configured the message names that path and its
 * action opens the kernel path setting (the thing to fix). Otherwise the action
 * is a "Don't Show Again" that opens the warning setting so the user can turn
 * the check off for good.
 */
async function showMismatchWarning(
	running: string,
	runningCommit: string,
	expectedCommit: string,
	customKernelPath: string | undefined,
): Promise<void> {
	const dontShowAgain = vscode.l10n.t('Don\'t Show Again');
	const openKernelPathSetting = vscode.l10n.t('Open Setting');

	let message: string;
	let buttons: string[];
	if (customKernelPath) {
		message = vscode.l10n.t(
			'The custom Ark R kernel at {0} ({1}, commit {2}) was built from a different ' +
			'commit than the one Positron expects ({3}). Update the "R: Kernel Path" setting ' +
			'to point at a matching build, or clear it to use the kernel bundled with Positron.',
			customKernelPath,
			running,
			runningCommit,
			expectedCommit);
		buttons = [openKernelPathSetting, dontShowAgain];
	} else {
		message = vscode.l10n.t(
			'The running Ark R kernel ({0}) was built from a different commit ({1}) than the one ' +
			'Positron expects ({2}). This version of Ark may not be compatible with your version ' +
			'of Positron.',
			running,
			runningCommit,
			expectedCommit);
		buttons = [dontShowAgain];
	}

	const choice = await vscode.window.showWarningMessage(message, ...buttons);
	if (choice === openKernelPathSetting) {
		await vscode.commands.executeCommand('workbench.action.openSettings', `@id:${CONFIG_SECTION}.${KERNEL_PATH_SETTING}`);
	} else if (choice === dontShowAgain) {
		await vscode.commands.executeCommand('workbench.action.openSettings', `@id:${CONFIG_SECTION}.${WARN_ON_MISMATCH_SETTING}`);
	}
}

/**
 * Determine the commit Positron expects Ark to have been built from. Prefers the
 * live submodule HEAD (dev builds, most accurate), falling back to the bundled
 * `SUBMODULE_COMMIT` sidecar (release builds). Returns undefined when neither is
 * available.
 */
async function readExpectedCommit(): Promise<ExpectedCommit | undefined> {
	// Dev build: the live submodule HEAD is authoritative.
	if (await fileExists(path.join(arkSubmoduleDir, '.git'))) {
		try {
			return { commit: await git(['rev-parse', 'HEAD']), source: 'git' };
		} catch (err) {
			LOGGER.debug(`Ark version check: could not read submodule HEAD: ${err}`);
			// Fall through to the sidecar.
		}
	}

	// Release build (or git unavailable): the sidecar written at install time.
	try {
		const sidecar = (await fs.promises.readFile(submoduleCommitFile, 'utf8')).trim();
		if (sidecar) {
			return { commit: sidecar, source: 'sidecar' };
		}
	} catch {
		// No sidecar present.
	}

	return undefined;
}

/** Whether a path exists, without throwing.
 * Be mindful about TOCTOU races.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Whether the submodule HEAD is an ancestor of Ark's `origin/main` (i.e. it has
 * no local commits on top). Returns false on any git error so an unknowable
 * state stays silent.
 */
async function isSubmoduleAncestorOfMain(): Promise<boolean> {
	try {
		// Exits 0 when HEAD is an ancestor of origin/main, 1 otherwise.
		await execFileAsync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], {
			cwd: arkSubmoduleDir,
			timeout: GIT_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

/** Run a git command in the submodule and return its trimmed stdout. */
async function git(args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, {
		cwd: arkSubmoduleDir,
		encoding: 'utf8',
		timeout: GIT_TIMEOUT_MS,
	});
	return stdout.trim();
}
