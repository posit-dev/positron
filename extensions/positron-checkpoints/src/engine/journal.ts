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
 * temporary files named in its journal. A `written` entry follows the `path` entry of a regular
 * file the operation creates (its before value is absent), once the new content is in the
 * temporary file: `raw` is the blob id of those bytes as they are on disk, with no filters (`git
 * hash-object --no-filters`). A `kept-returned` entry follows a complete record whose
 * `returnKept` files were all handled (see `returnKeptFiles`).
 */
export type Progress =
	| ({ step: 'kept' } & KeptMove) | { step: 'path'; path: string; temporary?: string } | { step: 'written'; path: string; raw: string }
	| { step: 'index' } | { step: 'branch' } | { step: 'kept-returned' } | { step: 'ref-change'; index: number };

/**
 * One change to a ref, the symbolic value of HEAD, or a configuration section. `undefined` means
 * absent.
 *
 * - `ref`: a full ref name (`refs/heads/main`) and commit ids.
 * - `head`: full ref names, for example `refs/heads/main`.
 * - `config-section`: a section of the repository's own configuration (`branch.<name>`), with
 *   every key and value it has, in file order. An empty list means the section is absent. Key
 *   names compare without regard to case, as git compares them.
 * - `engine-file`: a file in the engine's folder, by its name, with its text.
 */
export type RefChange =
	| { type: 'ref'; name: string; before?: string; after?: string }
	| { type: 'head'; before: string; after: string }
	| { type: 'config-section'; section: string; before: [string, string][]; after: [string, string][] }
	| { type: 'engine-file'; name: string; before?: string; after?: string };

/**
 * A file outside the snapshot that an operation moves aside (spec 6.2), from its place in the
 * project to its place in the kept folder. `sizeBytes` and `blob` (the id `readDiskEntries` gives,
 * null when it could not be read) describe the file when the record was written, so recovery can
 * tell that a file not yet moved is unchanged.
 */
export interface KeptMove { from: string; to: string; sizeBytes: number; blob: string | null }
export type JournalStatus = 'prepared' | 'complete' | 'rolled-back' | 'abandoned' | 'interrupted' | 'pending-approval';

/**
 * Marks the record of an Undo or a Redo (spec 6.3), with the id of the operation it reverses or
 * applies again. Such a record is never an entry of the undo or redo list itself.
 */
export interface OperationRole { kind: 'undo' | 'redo'; target: string }

export interface JournalRecord {
	id: string; kind: OperationKind; description: string; time: string; branch: string;
	before: TriState; after: TriState; paths: PathPlan[]; skipped: string[];
	keptMoves: KeptMove[]; progress: Progress[]; status: JournalStatus;
	redoWorktreeTree?: string; pending?: { token: string; approvedTree: string; resultTree: string; candidate: string };
	role?: OperationRole;
	/**
	 * Files that an earlier operation (`operationId`) moved aside, to move back to their places once
	 * this record is complete. Set for an Undo.
	 */
	returnKept?: { operationId: string; moves: KeptMove[] };
	/**
	 * Changes the operation applies in order after the working files and the index. In a record
	 * with ref changes, `before.branchCommit` and `after.branchCommit` are equal: they name the
	 * commit HEAD's branch is at before and after the operation, and every ref the operation moves
	 * is a ref change.
	 */
	refChanges?: RefChange[];
	/**
	 * The index into `refChanges` of the change that decides the operation: once it is applied, the
	 * operation is completed and never reversed. Without it, the last change decides.
	 */
	commitPoint?: number;
}

export type Part = 'before' | 'after' | 'unexpected';

/**
 * `refChanges` has the part of each ref change of a record that has them, by index. For such a
 * record `branch` is the part of the change at the commit point, which decides whether the
 * operation is completed or reversed.
 */
export interface Classification { branch: Part; index: Part; paths: { path: string; part: Part }[]; refChanges?: Part[] }

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
 * unexpected. A path the record creates that still holds only what the operation has not yet
 * moved or removed counts as before (see `explainPending`).
 *
 * For a record with ref changes:
 * - A configuration section with a progress entry that has only part of the keys the engine
 *   writes (see `isPartialSection`) counts as after: the engine wrote it, and nothing else has.
 * - A change at the commit point that is a ref whose after commit is an ancestor of the ref's
 *   commit now counts as after: it was applied, and another tool added checkpoints on top.
 * - Once the change at the commit point is after, every change before it was applied first, so
 *   such a change found at its before value was put back by another tool, and is unexpected.
 */
export async function classify(ports: EnginePorts, record: JournalRecord): Promise<Classification> {
	const index = partOf(await readIndexTree(ports), record.before.indexTree, record.after.indexTree);
	const paths = await explainPending(ports, record, await classifyPaths(ports, record.paths));
	if (record.refChanges === undefined) {
		return { branch: partOf(await readBranch(ports, record.branch), record.before.branchCommit, record.after.branchCommit), index, paths };
	}
	const listed = (position: number) => record.progress.some(entry => entry.step === 'ref-change' && entry.index === position);
	const refChanges: Part[] = [];
	for (const [position, change] of record.refChanges.entries()) {
		const now = await readRefTarget(ports, change);
		const part = partOf(now, refChangeSide(change, 'before'), refChangeSide(change, 'after'));
		refChanges.push(part === 'unexpected' && listed(position) && isPartialSection(change, now) ? 'after' : part);
	}
	const decisive = commitPointOf(record);
	const point = record.refChanges[decisive];
	if (refChanges[decisive] === 'unexpected' && point?.type === 'ref' && point.after !== undefined) {
		// Another tool added checkpoints on top of the ref's after commit; the change was applied.
		const now = await readRefTarget(ports, point);
		if (now !== undefined && (await runGit(ports.git, ['-C', ports.projectRoot, 'merge-base', '--is-ancestor', point.after, now])).exitCode === 0) {
			refChanges[decisive] = 'after';
		}
	}
	if (refChanges[decisive] === 'after') {
		record.refChanges.forEach((change, position) => {
			if (position < decisive && refChanges[position] === 'before' && refChangeSide(change, 'before') !== refChangeSide(change, 'after')) {
				refChanges[position] = 'unexpected';
			}
		});
	}
	return { branch: refChanges[decisive] ?? 'before', index, paths, refChanges };
}

/**
 * True when the index is part of what `record` changes: it lists an index step, or its before
 * and after index trees differ. An index that differs from a record that does not change it is
 * the person's own staged work, which no recovery step touches.
 */
export function changesIndex(record: JournalRecord): boolean {
	return record.before.indexTree !== record.after.indexTree || record.progress.some(entry => entry.step === 'index');
}

/**
 * True when `change` is a configuration section and `now` (in the form `readRefTarget` gives) is
 * the first keys of its before value or of its after value, which is what a write of the section
 * that stopped part way leaves. The engine writes a section by removing it whole and adding its
 * keys in order, so such content is rewritten whole by the next write of either value.
 */
export function isPartialSection(change: RefChange, now: string | undefined): boolean {
	if (change.type !== 'config-section' || now === undefined) {
		return false;
	}
	const prefixes = (entries: [string, string][]) => entries.map((_entry, count) => sectionText(entries.slice(0, count)));
	return [...prefixes(change.before), ...prefixes(change.after)].includes(now);
}

/** The index of the ref change that decides `record`: its `commitPoint`, or else its last change. */
export function commitPointOf(record: Pick<JournalRecord, 'refChanges' | 'commitPoint'>): number {
	return record.commitPoint ?? (record.refChanges?.length ?? 0) - 1;
}

/** The change that undoes `change`: the same target, with its before and after values swapped. */
export function invertRefChange(change: RefChange): RefChange {
	switch (change.type) {
		case 'head':
			return { type: 'head', before: change.after, after: change.before };
		case 'config-section':
			return { type: 'config-section', section: change.section, before: change.after, after: change.before };
		default:
			return withoutUndefined({ type: change.type, name: change.name, before: change.after, after: change.before });
	}
}

/** `change` without the keys whose value is undefined, so it reads the same after a trip through JSON. */
function withoutUndefined<T extends RefChange>(change: T): T {
	return Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)) as T;
}

/**
 * One side of `change` in the form `readRefTarget` reads its target: the commit id, the full ref
 * name, the file's text, or for a configuration section a JSON text of its keys (in lower case)
 * and values; undefined for an absent ref or file.
 */
export function refChangeSide(change: RefChange, side: 'before' | 'after'): string | undefined {
	if (change.type === 'config-section') {
		return sectionText(change[side]);
	}
	return change[side];
}

function sectionText(entries: [string, string][]): string {
	return JSON.stringify(entries.map(([key, value]) => [key.toLowerCase(), value]));
}

/** The target of `change` as it is now, in the form `refChangeSide` gives. A HEAD that names no branch reads as undefined. */
export async function readRefTarget(ports: EnginePorts, change: RefChange): Promise<string | undefined> {
	switch (change.type) {
		case 'ref': {
			const result = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', '--end-of-options', change.name]);
			return result.exitCode === 0 ? result.stdout.trim() : undefined;
		}
		case 'head': {
			const result = await runGit(ports.git, ['-C', ports.projectRoot, 'symbolic-ref', '-q', 'HEAD']);
			return result.exitCode === 0 ? result.stdout.trim() : undefined;
		}
		case 'config-section':
			return sectionText(await readConfigSection(ports, change.section));
		case 'engine-file': {
			const content = await ports.files.read(await engineFilePath(ports, change.name));
			return content === undefined ? undefined : Buffer.from(content).toString('utf8');
		}
	}
}

/** The path of the engine file `name`, a plain file name in the engine's folder. */
export async function engineFilePath(ports: EnginePorts, name: string): Promise<string> {
	if (name === '' || name === '.' || name === '..' || /[\\/]/.test(name)) {
		throw new Error(`${name} is not a file name in the engine's folder`);
	}
	return `${await engineDirectory(ports)}/${name}`;
}

/**
 * Every key and value of the configuration section `section` (`branch.<name>`, or a section with
 * no subsection) in the repository's own configuration file, in file order. Git gives key names
 * in lower case. A key with no value (a boolean written as the key alone) reads as `true`, the
 * value git gives it, so a section written back from this list keeps the key's meaning.
 */
export async function readConfigSection(ports: EnginePorts, section: string): Promise<[string, string][]> {
	const dot = section.indexOf('.');
	const prefix = (dot === -1 ? section.toLowerCase() : section.slice(0, dot).toLowerCase() + section.slice(dot)) + '.';
	const output = (await mustGit(ports.git, ['-C', ports.projectRoot, 'config', '--local', '--no-includes', '-z', '--list'])).stdout;
	const entries: [string, string][] = [];
	for (const item of splitZ(output)) {
		const newline = item.indexOf('\n');
		const key = newline === -1 ? item : item.slice(0, newline);
		const name = key.slice(prefix.length);
		if (key.startsWith(prefix) && name !== '' && !name.includes('.')) {
			entries.push([name, newline === -1 ? 'true' : item.slice(newline + 1)]);
		}
	}
	return entries;
}

/**
 * Before the operation writes a path it creates (before value null), it moves aside the files it
 * keeps a copy of and removes the files it removes. A crash before those steps leaves a path that
 * reads as unexpected although only the operation's own pending work is there. Such a path counts
 * as before when it is one of these:
 *
 * - a file the record moves aside that is still in place, unchanged (same size and blob id as
 *   recorded), and not yet in the kept folder
 * - a folder that holds a file the record moves aside, when every file in it (tracked or
 *   untracked, ignored ones included) is such a file or a path of the record that is not
 *   unexpected; the folder may be empty once its files are moved
 *
 * Names are compared in lower case on a case-insensitive file system.
 */
async function explainPending(ports: EnginePorts, record: JournalRecord, paths: { path: string; part: Part }[]): Promise<{ path: string; part: Part }[]> {
	const candidates = paths.filter(({ path, part }) => part === 'unexpected' && record.paths.find(plan => plan.path === path)?.before === null);
	if (candidates.length === 0) {
		return paths;
	}
	const caseInsensitive = await ports.files.caseInsensitive();
	const key = (file: string) => caseInsensitive ? file.toLowerCase() : file;
	const pending = new Set((await pendingKeptFiles(ports, record)).map(key));
	const settled = new Set(paths.filter(({ part }) => part !== 'unexpected').map(({ path }) => key(path)));
	const explained = new Set<string>();
	for (const { path: file } of candidates) {
		if (pending.has(key(file))) {
			explained.add(file);
			continue;
		}
		const holdsKept = record.keptMoves.some(move => key(move.from).startsWith(key(file) + '/'));
		if (!holdsKept || !(await ports.files.lstat(file))?.isDirectory) {
			continue;
		}
		const inside = splitZ((await mustGit(ports.git, [
			'-C', ports.projectRoot, 'ls-files', '-z', '--cached', '--others', '--', `:(literal${caseInsensitive ? ',icase' : ''})${file}`,
		])).stdout).filter(inner => key(inner) !== key(file));
		if (inside.every(inner => pending.has(key(inner)) || settled.has(key(inner)))) {
			explained.add(file);
		}
	}
	return paths.map(entry => explained.has(entry.path) ? { ...entry, part: 'before' } : entry);
}

/** The `from` of each kept move of `record` whose file is still in place, unchanged, and not yet moved. */
async function pendingKeptFiles(ports: EnginePorts, record: JournalRecord): Promise<string[]> {
	const candidates: KeptMove[] = [];
	for (const move of record.keptMoves) {
		const info = await ports.files.lstat(move.from);
		if (move.blob === null || info === undefined || info.isDirectory || info.sizeBytes !== move.sizeBytes || await ports.files.lstat(move.to) !== undefined) {
			continue;
		}
		candidates.push(move);
	}
	if (candidates.length === 0) {
		return [];
	}
	const entries = await readDiskEntries(ports, candidates.map(move => ({ path: move.from, before: null, after: null, beforeMode: null, afterMode: null })));
	return candidates
		.filter(move => {
			const entry = entries.get(move.from);
			return entry !== null && entry !== undefined && entry !== 'other' && entry.blob === move.blob;
		})
		.map(move => move.from);
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
