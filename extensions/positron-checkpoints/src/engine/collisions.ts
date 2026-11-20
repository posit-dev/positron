/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { mustGit, splitZ } from './git';
import { acquireLock, engineDirectory, PathPlan } from './journal';
import { EnginePorts } from './ports';
import { KeptFile, OperationResult, PathCollision } from './types';

/** Pathspecs per git call, so a large plan stays within the command line limit. */
const PATHSPECS_PER_CALL = 500;

/**
 * Lists the files on disk that `paths` would replace and that no snapshot covers (spec 6.2): a
 * file ignored by git or listed in `skipped` (untracked and too large), when the plan creates or
 * replaces a file at its path, creates a file inside it (turns it into a folder), or replaces a
 * folder that holds it with a file. Each collision names the file on disk, sorted by path. On a
 * case-insensitive file system, names are compared in lower case, so `Data.csv` collides with
 * `data.csv`.
 *
 * Git decides what is ignored (`ls-files --others --ignored --exclude-standard`), limited to the
 * files directly inside each folder above a written path and to the contents of a written path
 * that is a folder on disk.
 */
export async function findCollisions(ports: EnginePorts, paths: PathPlan[], skipped: string[]): Promise<PathCollision[]> {
	const written = paths.filter(plan => plan.after !== null).map(plan => plan.path);
	if (written.length === 0) {
		return [];
	}
	const caseInsensitive = await ports.files.caseInsensitive();
	const key = (file: string) => caseInsensitive ? file.toLowerCase() : file;
	const magic = caseInsensitive ? ',icase' : '';

	// A file at one of these names collides: a written path, or a folder a written path needs.
	const exact = new Set<string>();
	// A file below one of these folders collides: a written path that is a folder on disk.
	const replacedFolders: string[] = [];
	const folders = new Set<string>();
	const pathspecs: string[] = [];
	for (const file of written) {
		exact.add(key(file));
		for (let folder = path.posix.dirname(file); ; folder = path.posix.dirname(folder)) {
			folders.add(folder);
			if (folder === '.') {
				break;
			}
			exact.add(key(folder));
		}
		if ((await ports.files.lstat(file))?.isDirectory) {
			replacedFolders.push(key(file) + '/');
			pathspecs.push(`:(literal${magic})${file}`);
		}
	}
	for (const folder of folders) {
		pathspecs.push(`:(glob${magic})${folder === '.' ? '' : escapeGlob(folder) + '/'}*`);
	}
	const collides = (file: string) => exact.has(key(file)) || replacedFolders.some(folder => key(file).startsWith(folder));

	const found = new Map<string, PathCollision['reason']>();
	for (let start = 0; start < pathspecs.length; start += PATHSPECS_PER_CALL) {
		const args = ['-C', ports.projectRoot, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ...pathspecs.slice(start, start + PATHSPECS_PER_CALL)];
		for (const file of splitZ((await mustGit(ports.git, args)).stdout)) {
			if (collides(file)) {
				found.set(file, 'ignored');
			}
		}
	}
	for (const file of skipped) {
		if (collides(file)) {
			found.set(file, 'too-large');
		}
	}

	const collisions: PathCollision[] = [];
	for (const [file, reason] of found) {
		collisions.push({ path: file, reason, sizeBytes: (await ports.files.lstat(file))?.sizeBytes ?? 0 });
	}
	return collisions.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/** Escapes the characters a `:(glob)` pathspec treats as patterns. */
function escapeGlob(text: string): string {
	return text.replace(/[*?[\]\\]/g, character => `\\${character}`);
}

/** The folder of kept files, which also holds their index file. */
async function keptDirectory(ports: EnginePorts): Promise<string> {
	return `${await engineDirectory(ports)}/kept`;
}

/** Where `moveAside` keeps the file at `file` for the operation `operationId`. */
export async function keptPath(ports: EnginePorts, operationId: string, file: string): Promise<string> {
	return `${await keptDirectory(ports)}/${operationId}/${file}`;
}

type KeptLine = { type: 'kept'; file: KeptFile } | { type: 'removed'; id: string };

async function appendKeptLine(ports: EnginePorts, line: KeptLine): Promise<void> {
	await ports.files.appendDurable(`${await keptDirectory(ports)}/index.jsonl`, '\n' + JSON.stringify(line));
}

/**
 * Moves the file at `file` into `.git/positron-checkpoints/kept/<operationId>/<file>` (spec 6.2),
 * and removes the folders above it that the move leaves empty. The entry in `kept/index.jsonl`
 * (id `<operationId>/<file>`, original path, size, time, and `action`, the description of the
 * operation) is written first, so a kept file always has an entry; an entry whose file is not in
 * the kept folder is not listed.
 */
export async function moveAside(ports: EnginePorts, operationId: string, file: string, action: string): Promise<{ from: string; to: string }> {
	const to = await keptPath(ports, operationId, file);
	const info = await ports.files.lstat(file);
	await appendKeptLine(ports, {
		type: 'kept',
		file: { id: `${operationId}/${file}`, originalPath: file, sizeBytes: info?.sizeBytes ?? 0, time: ports.now().toISOString(), action },
	});
	await ports.files.move(file, to);
	await removeEmptyFolders(ports, file, '.');
	return { from: file, to };
}

/**
 * Moves a kept file back to `from` when nothing is at `from` (the reversal of `moveAside`), and
 * removes its entry. Returns false, and changes nothing, when `from` is occupied or the kept
 * file is gone.
 */
export async function moveBack(ports: EnginePorts, operationId: string, move: { from: string; to: string }): Promise<boolean> {
	if (await ports.files.lstat(move.to) === undefined || !await placeExclusive(ports, move.to, move.from)) {
		return false;
	}
	await appendKeptLine(ports, { type: 'removed', id: `${operationId}/${move.from}` });
	await removeEmptyFolders(ports, move.to, await keptDirectory(ports));
	return true;
}

/**
 * Moves the file at `source` to `target` only when nothing is at `target`: `target` becomes a
 * second name of the file (or an exclusively created copy across file systems), then `source` is
 * removed. A file created at `target` at any moment is never replaced. Returns false, and
 * changes nothing, when `target` is occupied.
 */
async function placeExclusive(ports: EnginePorts, source: string, target: string): Promise<boolean> {
	try {
		await ports.files.linkOrCopy(source, target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			return false;
		}
		throw error;
	}
	await ports.files.remove(source);
	return true;
}

/** Every kept file whose file is still in the kept folder, oldest first. */
export async function listKept(ports: EnginePorts): Promise<KeptFile[]> {
	const content = await ports.files.read(`${await keptDirectory(ports)}/index.jsonl`);
	if (content === undefined) {
		return [];
	}
	const entries = new Map<string, KeptFile>();
	for (const text of Buffer.from(content).toString('utf8').split('\n')) {
		if (text.trim() === '') {
			continue;
		}
		let line: KeptLine;
		try {
			line = JSON.parse(text);
		} catch {
			// The end of a line a crash cut short.
			continue;
		}
		if (line.type === 'kept') {
			entries.set(line.file.id, line.file);
		} else if (line.type === 'removed') {
			entries.delete(line.id);
		}
	}
	const kept: KeptFile[] = [];
	for (const entry of entries.values()) {
		if (await ports.files.lstat(await keptFileOf(ports, entry)) !== undefined) {
			kept.push(entry);
		}
	}
	return kept;
}

/** The file in the kept folder of an entry, whose id is `<operation id>/<original path>`. */
async function keptFileOf(ports: EnginePorts, entry: KeptFile): Promise<string> {
	return keptPath(ports, entry.id.slice(0, entry.id.length - entry.originalPath.length - 1), entry.originalPath);
}

/**
 * Moves a kept file back to its original path, or to `destination` (a path in the project).
 * Returns `unavailable occupied`, and changes nothing, when something is at the target, even a
 * file created while the move runs; a kept file never replaces another file. Returns
 * `unavailable nothing-to-do` for an unknown id and `unavailable busy` while another window
 * holds the lock.
 */
export async function restoreKept(ports: EnginePorts, id: string, destination?: string): Promise<OperationResult> {
	return withKept(ports, id, async (entry, file) => {
		if (!await placeExclusive(ports, file, destination ?? entry.originalPath)) {
			return { kind: 'unavailable', reason: 'occupied' };
		}
		await appendKeptLine(ports, { type: 'removed', id });
		await removeEmptyFolders(ports, file, await keptDirectory(ports));
		return { kind: 'done', operationId: id, hookEditedFiles: [] };
	});
}

/** Deletes a kept file and its entry. Results as for `restoreKept`, apart from `occupied`. */
export async function deleteKept(ports: EnginePorts, id: string): Promise<OperationResult> {
	return withKept(ports, id, async (_entry, file) => {
		// The file goes first, so an entry is never removed while its file remains.
		await ports.files.remove(file);
		await appendKeptLine(ports, { type: 'removed', id });
		await removeEmptyFolders(ports, file, await keptDirectory(ports));
		return { kind: 'done', operationId: id, hookEditedFiles: [] };
	});
}

/** Runs `fn` under the engine lock with the listed kept file `id` and the path of its file. */
async function withKept(ports: EnginePorts, id: string, fn: (entry: KeptFile, file: string) => Promise<OperationResult>): Promise<OperationResult> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return { kind: 'unavailable', reason: 'busy' };
	}
	try {
		const entry = (await listKept(ports)).find(candidate => candidate.id === id);
		if (entry === undefined) {
			return { kind: 'unavailable', reason: 'nothing-to-do' };
		}
		try {
			return await fn(entry, await keptFileOf(ports, entry));
		} catch (error) {
			return { kind: 'could-not-finish', detail: error instanceof Error ? error.message : String(error) };
		}
	} finally {
		await lock.release().catch(() => undefined);
	}
}

/** Removes the empty folders above `file`, nearest first, stopping at `root`. */
async function removeEmptyFolders(ports: EnginePorts, file: string, root: string): Promise<void> {
	for (let folder = path.posix.dirname(file); folder !== root && folder !== '.' && folder !== '/'; folder = path.posix.dirname(folder)) {
		if (!await ports.files.removeEmptyDirectory(folder)) {
			break;
		}
	}
}
