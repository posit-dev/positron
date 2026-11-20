/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as os from 'os';
import { mustGit, runGit, splitZ } from './git';
import { EnginePorts } from './ports';
import { absoluteGitDir, STAGING_TIMEOUT_MS, withTempIndex } from './trees';
import { OperationKind } from './types';

/** The git modes of the files the engine writes: a regular file, an executable file, a symbolic link. */
export type FileMode = '100644' | '100755' | '120000';

/** One of the three parts of a project (spec 6.3.1): the branch, the real index, and the working files. */
export interface TriState { branchCommit: string | null; indexTree: string; worktreeTree: string }

/**
 * A working file an operation writes or removes. `before` and `after` are git blob ids, `null`
 * for an absent file, and each mode describes the file with that id (a symbolic link's blob is
 * its target). The blob id of a file on disk is defined by `readDiskEntries`.
 */
export interface PathPlan { path: string; before: string | null; after: string | null; beforeMode: FileMode | null; afterMode: FileMode | null }

/**
 * An entry the engine appends before it changes a part. A `path` entry names the temporary file
 * the engine creates for the path's new content, when there is one; the engine removes only
 * temporary files named in its journal.
 */
export type Progress = { step: 'kept'; from: string; to: string } | { step: 'path'; path: string; temporary?: string } | { step: 'index' } | { step: 'branch' };
export type JournalStatus = 'prepared' | 'complete' | 'rolled-back' | 'abandoned' | 'interrupted' | 'pending-approval';

export interface JournalRecord {
	id: string; kind: OperationKind; description: string; time: string; branch: string;
	before: TriState; after: TriState; paths: PathPlan[]; skipped: string[];
	keptMoves: { from: string; to: string }[]; progress: Progress[]; status: JournalStatus;
	redoWorktreeTree?: string; pending?: { token: string; approvedTree: string; resultTree: string; candidate: string };
}

export type Part = 'before' | 'after' | 'unexpected';
export interface Classification { branch: Part; index: Part; paths: { path: string; part: Part }[] }

/** A lock this old is taken over when the engine cannot tell whether the process that took it runs. */
const STALE_LOCK_MS = 10 * 60_000;

/** The folder of the engine's own files inside the git directory. */
export async function engineDirectory(ports: EnginePorts): Promise<string> {
	return `${await absoluteGitDir(ports)}/positron-checkpoints`;
}

interface LockContent { pid: number; host: string; time: string; token: string }

/**
 * Takes the engine lock (`<git dir>/positron-checkpoints/lock`), which records the process id,
 * the host name, and the time. Returns undefined when another holder has it. A lock whose
 * process is not running on this host is taken over at once. When the engine cannot tell (the
 * lock is from another host, or its content is unreadable), a lock older than 10 minutes is
 * taken over. `release` removes the lock only while it is still this holder's.
 */
export async function acquireLock(ports: EnginePorts): Promise<{ release(): Promise<void> } | undefined> {
	const file = `${await engineDirectory(ports)}/lock`;
	const content: LockContent = { pid: process.pid, host: os.hostname(), time: ports.now().toISOString(), token: randomUUID() };
	const text = JSON.stringify(content);
	const release = async () => {
		const current = await ports.files.read(file);
		if (current !== undefined && Buffer.from(current).toString('utf8') === text) {
			await ports.files.remove(file);
		}
	};

	if (await ports.files.createExclusive(file, text)) {
		return { release };
	}
	const held = await ports.files.read(file);
	if (held === undefined || !(await isStale(ports, file, held))) {
		return undefined;
	}
	// Two windows can both judge the same lock stale. Each renames it to its own name, and only one
	// rename finds the file. A window that judged an old lock but renamed the new lock of a window
	// that took over first sees content it did not judge, puts that lock back, and gives up. Only a
	// third window that creates a lock in that short gap can still share the lock.
	const aside = `${file}.stale-${randomUUID()}`;
	try {
		await ports.files.move(file, aside);
	} catch {
		return undefined;
	}
	const moved = await ports.files.read(aside);
	if (moved === undefined || Buffer.compare(Buffer.from(moved), Buffer.from(held)) !== 0) {
		if (moved !== undefined) {
			await ports.files.createExclusive(file, Buffer.from(moved).toString('utf8'));
		}
		await ports.files.remove(aside);
		return undefined;
	}
	await ports.files.remove(aside);
	return await ports.files.createExclusive(file, text) ? { release } : undefined;
}

/**
 * True when the lock's process is not running on this host, or, when that cannot be told, when
 * the lock is older than the stale limit.
 */
async function isStale(ports: EnginePorts, file: string, held: Uint8Array): Promise<boolean> {
	let lock: Partial<LockContent> = {};
	try {
		lock = JSON.parse(Buffer.from(held).toString('utf8'));
	} catch {
		// A lock written only in part has no usable content; its file time gives its age.
	}
	if (typeof lock.pid === 'number' && lock.host === os.hostname()) {
		return !isProcessRunning(lock.pid);
	}
	let taken = typeof lock.time === 'string' ? Date.parse(lock.time) : NaN;
	if (Number.isNaN(taken)) {
		taken = (await ports.files.lstat(file))?.mtimeMs ?? 0;
	}
	return ports.now().getTime() - taken >= STALE_LOCK_MS;
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: the process exists and belongs to another user.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

type JournalLine =
	| { type: 'record'; record: JournalRecord }
	| { type: 'progress'; id: string; entry: Progress }
	| { type: 'status'; id: string; status: JournalStatus };

/**
 * Appends one line to `journal.jsonl` and flushes it. Each line starts with a line break, so a
 * line that a crash cut short never joins the line written after it.
 */
async function appendLine(ports: EnginePorts, line: JournalLine): Promise<void> {
	await ports.files.appendDurable(`${await engineDirectory(ports)}/journal.jsonl`, '\n' + JSON.stringify(line));
}

/** Writes a whole record. A later record line with the same id replaces it. */
export async function writeRecord(ports: EnginePorts, record: JournalRecord): Promise<void> {
	await appendLine(ports, { type: 'record', record });
}

export async function appendProgress(ports: EnginePorts, id: string, entry: Progress): Promise<void> {
	await appendLine(ports, { type: 'progress', id, entry });
}

export async function setStatus(ports: EnginePorts, id: string, status: JournalStatus): Promise<void> {
	await appendLine(ports, { type: 'status', id, status });
}

/**
 * Reads every record in the order it was first written, with the latest record line for its
 * id, the progress entries and status lines that follow it applied. A line that is not
 * complete JSON (the end of a crash) is ignored.
 */
export async function readRecords(ports: EnginePorts): Promise<JournalRecord[]> {
	const content = await ports.files.read(`${await engineDirectory(ports)}/journal.jsonl`);
	if (content === undefined) {
		return [];
	}
	const records = new Map<string, JournalRecord>();
	for (const text of Buffer.from(content).toString('utf8').split('\n')) {
		if (text.trim() === '') {
			continue;
		}
		let line: JournalLine;
		try {
			line = JSON.parse(text);
		} catch {
			continue;
		}
		if (line.type === 'record') {
			records.set(line.record.id, { ...line.record, progress: [...line.record.progress] });
			continue;
		}
		const record = records.get(line.id);
		if (record === undefined) {
			continue;
		}
		if (line.type === 'progress') {
			record.progress.push(line.entry);
		} else if (line.type === 'status') {
			record.status = line.status;
		}
	}
	return [...records.values()];
}

/** What is on disk at a path: a file with its mode and blob id, nothing, or something else (a directory). */
export type DiskEntry = { mode: FileMode; blob: string } | null | 'other';

/**
 * Reads what is on disk at each path of `plans`. A path git refuses to add (one beyond a symbolic
 * link, one inside a nested repository) reads as something else, so it is never taken for a
 * known value.
 *
 * The blob id of a file on disk is the id `git add` records for it, which is how
 * `worktreeTree` builds the snapshot trees that the before values come from: the clean side
 * of line-ending conversion (`core.autocrlf`, `eol`) and of other filters applies, so a file
 * with Windows line endings under `core.autocrlf=true` reads as its normalized blob. Every
 * comparison of disk content with a plan uses this function. Files are added to a temporary
 * index that first holds the plan's own entry for the path (before, or after when there is no
 * before), so git's choices that depend on an existing entry (`core.autocrlf` keeps a stored
 * blob that has carriage returns; `core.fileMode=false` and `core.symlinks=false` keep the
 * stored mode) are the same as for the snapshot, which starts from the real index.
 */
export async function readDiskEntries(ports: EnginePorts, plans: PathPlan[]): Promise<Map<string, DiskEntry>> {
	const entries = new Map<string, DiskEntry>();
	const files: PathPlan[] = [];
	for (const plan of plans) {
		const info = await ports.files.lstat(plan.path);
		if (info === undefined) {
			entries.set(plan.path, null);
		} else if (info.isDirectory) {
			entries.set(plan.path, 'other');
		} else {
			files.push(plan);
		}
	}
	if (files.length === 0) {
		return entries;
	}
	const git = (args: string[], options: Parameters<EnginePorts['git']>[1]) => mustGit(ports.git, ['-C', ports.projectRoot, ...args], options);
	const refused = new Set<string>();
	const added = await withTempIndex(ports, async env => {
		const seeds = files
			.map(plan => plan.before !== null ? `${plan.beforeMode} ${plan.before}\t${plan.path}` : plan.after !== null ? `${plan.afterMode} ${plan.after}\t${plan.path}` : undefined)
			.filter((line): line is string => line !== undefined);
		if (seeds.length > 0) {
			await git(['update-index', '-z', '--index-info'], { env, stdin: seeds.join('\0') + '\0' });
		}
		const add = (paths: string[]) => runGit(ports.git, ['-C', ports.projectRoot, '--literal-pathspecs', 'add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], {
			env,
			stdin: paths.join('\0') + '\0',
			timeoutMs: STAGING_TIMEOUT_MS,
		});
		if ((await add(files.map(plan => plan.path))).exitCode !== 0) {
			// Git refuses some paths (one beyond a symbolic link, one inside a nested repository).
			// Adding one at a time finds them. Their seeded entry says nothing about the disk.
			for (const plan of files) {
				if ((await add([plan.path])).exitCode !== 0) {
					refused.add(plan.path);
				}
			}
		}
		const listed = new Map<string, string>();
		for (const line of splitZ((await git(['ls-files', '-s', '-z'], { env })).stdout)) {
			const tab = line.indexOf('\t');
			listed.set(line.slice(tab + 1), line.slice(0, tab));
		}
		return listed;
	});
	for (const plan of files) {
		if (refused.has(plan.path)) {
			entries.set(plan.path, 'other');
			continue;
		}
		const [mode, blob] = added.get(plan.path)?.split(' ') ?? [];
		entries.set(plan.path, mode === '100644' || mode === '100755' || mode === '120000' ? { mode, blob } : 'other');
	}
	return entries;
}

/**
 * Classifies the branch, the real index, and every path of `record` as its before value, its
 * after value, or neither ("unexpected"). A value equal to both counts as before. A branch
 * that does not exist matches a `null` commit, and an index git cannot write a tree for is
 * unexpected.
 */
export async function classify(ports: EnginePorts, record: JournalRecord): Promise<Classification> {
	return {
		branch: partOf(await readBranch(ports, record.branch), record.before.branchCommit, record.after.branchCommit),
		index: partOf(await readIndexTree(ports), record.before.indexTree, record.after.indexTree),
		paths: await classifyPaths(ports, record.paths),
	};
}

/** Classifies each path of `plans` by what is on disk now (see `readDiskEntries`). */
export async function classifyPaths(ports: EnginePorts, plans: PathPlan[]): Promise<{ path: string; part: Part }[]> {
	const entries = await readDiskEntries(ports, plans);
	const executableBitTracked = await isExecutableBitTracked(ports);
	const key = (mode: FileMode | null, blob: string | null): string | null => {
		if (blob === null || mode === null) {
			return null;
		}
		return `${executableBitTracked || mode === '120000' ? mode : '100644'} ${blob}`;
	};
	return plans.map(plan => {
		const entry = entries.get(plan.path);
		const disk = entry === 'other' || entry === undefined ? 'other' : entry === null ? null : key(entry.mode, entry.blob);
		return { path: plan.path, part: partOf(disk, key(plan.beforeMode, plan.before), key(plan.afterMode, plan.after)) };
	});
}

/** The commit the branch points at, or null when it does not exist. */
export async function readBranch(ports: EnginePorts, branch: string): Promise<string | null> {
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

/** The tree of the real index, or undefined when git cannot write one (an unfinished merge). */
export async function readIndexTree(ports: EnginePorts): Promise<string | undefined> {
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'write-tree'], { timeoutMs: STAGING_TIMEOUT_MS });
	return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

/** With `core.fileMode=false` git ignores the executable bit on disk, so the engine does too. */
async function isExecutableBitTracked(ports: EnginePorts): Promise<boolean> {
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'config', '--type=bool', '--get', 'core.fileMode']);
	return result.stdout.trim() !== 'false';
}

function partOf<T>(value: T | 'other' | undefined, before: T, after: T): Part {
	if (value === before) {
		return 'before';
	}
	if (value === after) {
		return 'after';
	}
	return 'unexpected';
}
