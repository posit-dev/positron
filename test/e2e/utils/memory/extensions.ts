/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
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
			isBuiltin: !userInstalledIds.has(extensionId),
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
 */
export async function readUserInstalledIds(extensionsDir: string): Promise<Set<string>> {
	try {
		const entries = await fs.readdir(extensionsDir, { withFileTypes: true });
		return new Set(
			entries
				.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
				.map(entry => entry.name.replace(/-\d+\.\d+\.\d+.*$/, ''))
		);
	} catch {
		return new Set();
	}
}

async function newestDirectory(dir: string, prefix = ''): Promise<string | undefined> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	return entries
		.filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
		.map(entry => entry.name)
		.sort()
		.at(-1);
}

async function windowLog(sessionDir: string): Promise<string | undefined> {
	const window = await newestDirectory(sessionDir, 'window');
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
		const session = await newestDirectory(logsRoot);
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
