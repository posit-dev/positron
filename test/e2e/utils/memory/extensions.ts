/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dirent, promises as fs } from 'fs';
import { join } from 'path';
import { ActivatedExtension } from './types.js';

/**
 * One activation as the extension host logs it, from
 * extHostExtensionService.ts: `_doActivateExtension <id>, startup: <bool>,
 * activationEvent: '<event>'` with an optional `, root cause: <id>` suffix.
 *
 * The event is captured up to the closing quote, so the root cause cannot leak
 * into it.
 */
const ACTIVATION_LINE = /_doActivateExtension (\S+?), startup: (?:true|false), activationEvent: '([^']*)'/;

/**
 * Read the activated-extension inventory out of the extension host log.
 *
 * This is the companion signal for memory the process tree cannot attribute:
 * Copilot and the Snowflake SDK both live inside the extension host, so no
 * amount of process detail separates them, but "extension host grew and this
 * extension newly activates at startup" is actionable.
 *
 * The log is used rather than the Running Extensions editor because it carries
 * the real extension id. That editor's rows show `marketplaceInfo.displayName`
 * truncated to 50 characters and have no id anywhere, and they carry no
 * activation-event element either - the event is only a hover title. Per-extension
 * activation times are the one thing only that editor has, which is why
 * `activationTimeMs` is always null here.
 *
 * @param userInstalledIds ids found in the run's extensions dir. Anything not in
 * that set shipped with the build. Passing an empty set marks everything builtin,
 * which is correct for a run against a fresh extensions dir.
 */
export function parseActivationLog(text: string, userInstalledIds: Set<string> = new Set()): ActivatedExtension[] {
	const byId = new Map<string, ActivatedExtension>();

	for (const line of text.split('\n')) {
		const match = line.match(ACTIVATION_LINE);
		if (!match) {
			continue;
		}
		const [, extensionId, activationEvent] = match;
		// An extension activates once; a second line for the same id is a later
		// event finding it already active, and the first is the one that cost
		// the memory.
		if (byId.has(extensionId)) {
			continue;
		}
		byId.set(extensionId, {
			extensionId,
			// Compared case-insensitively. The installed set comes from directory
			// names, which the extension manager lowercases, while the log reports
			// the id as the extension's package.json declares it. A case-sensitive
			// lookup marks every `GitHub.*` and `Posit.*` extension builtin.
			isBuiltin: !userInstalledIds.has(extensionId.toLowerCase()),
			activationTimeMs: null,
			activationEvent
		});
	}

	return [...byId.values()];
}

/**
 * Ids of extensions installed into a run's extensions dir, where directories are
 * named `<publisher>.<name>-<version>`. Returns an empty set if the directory is
 * missing, which is the common case for a fresh profile.
 *
 * Ids are lowercased, matching how the extension manager writes the directory
 * names, so callers must lowercase before looking one up.
 */
export async function readUserInstalledIds(extensionsDir: string): Promise<Set<string>> {
	try {
		const entries = await fs.readdir(extensionsDir, { withFileTypes: true });
		return new Set(
			entries
				.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
				.map(entry => entry.name.replace(/-\d+\.\d+\.\d+.*$/, '').toLowerCase())
		);
	} catch {
		return new Set();
	}
}

/** Version suffix on user-installed extension directories: `posit.air-vscode-0.4.1`. */
const DIRECTORY_VERSION = /-\d+\.\d+\.\d+.*$/;

/**
 * Real extension id per extension directory name, e.g. `copilot` ->
 * `GitHub.copilot-chat`.
 *
 * Read while the app's directories are still on disk, because the heap parse
 * runs in a later step by which point a temp extensions dir may be gone. A
 * directory whose manifest cannot be read is omitted rather than guessed at:
 * the caller falls back to the directory name, which is still a usable label.
 */
export async function readExtensionIdsByDirectory(roots: string[]): Promise<Record<string, string>> {
	const ids: Record<string, string> = {};
	for (const root of roots) {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) {
				continue;
			}
			try {
				const manifest = JSON.parse(await fs.readFile(join(root, entry.name, 'package.json'), 'utf8'));
				if (typeof manifest.publisher === 'string' && typeof manifest.name === 'string') {
					ids[entry.name.replace(DIRECTORY_VERSION, '')] = `${manifest.publisher}.${manifest.name}`;
				}
			} catch {
				continue;
			}
		}
	}
	return ids;
}

/** Log session dirs are named `<YYYYMMDD>T<HHMMSS>`. */
const SESSION_DIR = /^\d{8}T\d{6}$/;

/** Window dirs are named `window<n>`, with no zero padding. */
const WINDOW_DIR = /^window(\d+)$/;

async function directoryNames(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
}

/**
 * Newest session dir, by name. The timestamps are fixed width and zero padded,
 * so a lexicographic sort is chronological. Names that are not session dirs are
 * ignored: a stray scratch dir sorting after the real session would otherwise
 * win and hide a log that is present.
 */
async function newestSession(logsRoot: string): Promise<string | undefined> {
	return (await directoryNames(logsRoot)).filter(name => SESSION_DIR.test(name)).sort().at(-1);
}

/**
 * Highest-numbered window dir. Sorted numerically, because `window10` sorts
 * before `window2` as a string.
 */
async function newestWindow(sessionDir: string): Promise<string | undefined> {
	return (await directoryNames(sessionDir))
		.map(name => ({ name, index: Number(name.match(WINDOW_DIR)?.[1]) }))
		.filter(entry => !isNaN(entry.index))
		.sort((a, b) => a.index - b.index)
		.at(-1)?.name;
}

async function windowLog(sessionDir: string): Promise<string | undefined> {
	const window = await newestWindow(sessionDir);
	if (!window) {
		return undefined;
	}
	const candidate = join(sessionDir, window, 'exthost', 'exthost.log');
	try {
		await fs.access(candidate);
		return candidate;
	} catch {
		return undefined;
	}
}

/**
 * Find the extension host log for the newest window, given a logs root.
 *
 * Two layouts exist and both are verified against a real launch, because the
 * level of nesting depends on how the app was started:
 *
 * - Passed `--logsPath=<dir>`, as the e2e harness does, that directory *is* the
 *   session dir: `<root>/window1/exthost/exthost.log`. The default location is
 *   then not written at all.
 * - Started without it, the app makes a timestamped session dir of its own under
 *   the state dir (not the user data dir):
 *   `~/.local/state/positron/logs/<timestamp>/window1/exthost/exthost.log`.
 *
 * The direct layout is tried first, then the newest timestamped session below it.
 */
export async function findExtHostLog(logsRoot: string): Promise<string | undefined> {
	try {
		const direct = await windowLog(logsRoot);
		if (direct) {
			return direct;
		}
		const session = await newestSession(logsRoot);
		return session ? await windowLog(join(logsRoot, session)) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Returns an empty list on any failure. A missing inventory should cost us the
 * extension section of the report, not the whole run.
 */
export async function readActivatedExtensions(input: { logsRoot: string; extensionsDir?: string }): Promise<ActivatedExtension[]> {
	try {
		const logPath = await findExtHostLog(input.logsRoot);
		if (!logPath) {
			console.error(`[memory] no extension host log found under ${input.logsRoot}`);
			return [];
		}
		const userInstalled = input.extensionsDir ? await readUserInstalledIds(input.extensionsDir) : new Set<string>();
		return parseActivationLog(await fs.readFile(logPath, 'utf8'), userInstalled);
	} catch (error) {
		console.error(`[memory] could not read activated extensions: ${error}`);
		return [];
	}
}
