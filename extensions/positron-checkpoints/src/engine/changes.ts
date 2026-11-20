/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { mustGit as mustGitRunner, runGit, splitZ } from './git';
import { EnginePorts } from './ports';
import { indexTree, LARGE_FILE_BYTES, withTempIndex, worktreeTree } from './trees';
import { ChangedFile, ChangeSet, Chunk, Hunk } from './types';


/** A file whose working or checkpoint size is over this is listed without hunks. */
export const MAX_PATCH_FILE_BYTES = 5 * 1024 * 1024;

const GITLINK_MODE = '160000';

/** Settings that would change the format of a patch, whatever the user configured. */
const FIXED_DIFF_CONFIG = ['-c', 'core.quotepath=off', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.renames=true'];

/** Hunk ids are the first 16 hex characters of a SHA-256. */
const HUNK_ID_LENGTH = 16;

export type ChunkErrorCode = 'unknown-hunk' | 'repeated-hunk' | 'unknown-file' | 'changes-moved';

/**
 * A chunk names a hunk that does not exist, names a hunk twice, or names a file that did not
 * change, or the working files changed after the change set was read (`changes-moved`).
 */
export class ChunkError extends Error {
	constructor(readonly code: ChunkErrorCode, message: string) {
		super(message);
		this.name = 'ChunkError';
	}
}

/** Runs git in the project root and throws when it exits with an error. */
async function mustGit(ports: EnginePorts, args: string[], options?: Parameters<EnginePorts['git']>[1]): Promise<string> {
	return (await mustGitRunner(ports.git, ['-C', ports.projectRoot, ...args], options)).stdout;
}

/** Decodes a name read in binary mode (one character per byte) as UTF-8. */
function decodeName(binary: string): string {
	return Buffer.from(binary, 'latin1').toString('utf8');
}

interface ParsedHunk {
	/** The `@@` line, without its line end, one character per byte. */
	headerLine: string;
	/** Every line after the `@@` line, with line ends, one character per byte. */
	body: string;
}

interface ParsedSection {
	binary: boolean;
	hunks: ParsedHunk[];
}

/**
 * Splits the text of `git diff` (one character per byte) into one section for each file.
 * A content line always starts with a space, `+`, `-`, or a backslash, so a line that starts
 * with `diff --git ` or `@@ ` is always structure.
 */
function parsePatch(patch: string): ParsedSection[] {
	const sections: ParsedSection[] = [];
	let hunk: { headerLine: string; body: string[] } | undefined;
	let section: ParsedSection | undefined;
	let inHeader = false;
	const finishHunk = () => {
		if (hunk !== undefined && section !== undefined) {
			section.hunks.push({ headerLine: hunk.headerLine, body: hunk.body.join('') });
		}
		hunk = undefined;
	};
	let position = 0;
	while (position < patch.length) {
		const end = patch.indexOf('\n', position);
		const next = end === -1 ? patch.length : end + 1;
		const line = patch.slice(position, next);
		position = next;
		if (line.startsWith('diff --git ')) {
			finishHunk();
			section = { binary: false, hunks: [] };
			sections.push(section);
			inHeader = true;
		} else if (line.startsWith('@@ ') && section !== undefined) {
			finishHunk();
			inHeader = false;
			hunk = { headerLine: line.replace(/\r?\n$/, ''), body: [] };
		} else if (hunk !== undefined) {
			hunk.body.push(line);
		} else if (inHeader && section !== undefined && line.startsWith('Binary files ')) {
			section.binary = true;
		}
	}
	finishHunk();
	return sections;
}

interface RawEntry {
	status: ChangedFile['status'];
	path: string;
	oldPath?: string;
	typeChange: boolean;
	/** True when either side is a submodule entry. */
	gitlink: boolean;
}

/** Parses `git diff --raw -z`, whose paths are exact (never quoted). */
function parseRaw(output: string): RawEntry[] {
	const parts = splitZ(output);
	const entries: RawEntry[] = [];
	for (let i = 0; i < parts.length;) {
		const [oldMode, newMode, , , code] = parts[i++].slice(1).split(' ');
		const gitlink = oldMode === GITLINK_MODE || newMode === GITLINK_MODE;
		if (code.startsWith('R') || code.startsWith('C')) {
			const oldPath = decodeName(parts[i++]);
			entries.push({ status: 'renamed', path: decodeName(parts[i++]), oldPath, typeChange: false, gitlink });
		} else {
			const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
			entries.push({ status, path: decodeName(parts[i++]), typeChange: code.startsWith('T'), gitlink });
		}
	}
	return entries;
}

/** The size of every blob of `tree`, by path. */
async function blobSizes(ports: EnginePorts, tree: string): Promise<Map<string, number>> {
	const sizes = new Map<string, number>();
	for (const entry of splitZ(await mustGit(ports, ['ls-tree', '-r', '-l', '-z', tree], { binary: true }))) {
		const match = /^\d+ blob \w+ +(\d+)\t([\s\S]*)$/.exec(entry);
		if (match !== null) {
			sizes.set(decodeName(match[2]), Number(match[1]));
		}
	}
	return sizes;
}

/** Counts the added and removed lines of a hunk body. */
function countLines(body: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of body.split('\n')) {
		if (line.startsWith('+')) {
			added++;
		} else if (line.startsWith('-')) {
			removed++;
		}
	}
	return { added, removed };
}

function hunkId(path: string, body: string, earlierIdentical: number): string {
	return createHash('sha256')
		.update(Buffer.from(path, 'utf8'))
		.update('\0')
		.update(Buffer.from(body, 'latin1'))
		.update('\0')
		.update(String(earlierIdentical))
		.digest('hex')
		.slice(0, HUNK_ID_LENGTH);
}

/** The tree with no files, which git knows without storing it. */
async function emptyTree(ports: EnginePorts): Promise<string> {
	return (await mustGit(ports, ['hash-object', '-t', 'tree', '--stdin'], { stdin: '' })).trim();
}

/** The tree a change is measured against: the latest checkpoint, or the empty tree. */
async function baseTreeOf(ports: EnginePorts): Promise<{ head?: string; tree: string }> {
	const head = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', 'HEAD']);
	if (head.exitCode !== 0) {
		return { tree: await emptyTree(ports) };
	}
	const commit = head.stdout.trim();
	return { head: commit, tree: (await mustGit(ports, ['rev-parse', `${commit}^{tree}`])).trim() };
}

/**
 * Lists the files that differ between the latest checkpoint (or the empty tree when there is
 * none) and the working files, with the hunks of each text file. A hunk id depends on the
 * path, the hunk's lines, and how many identical hunks come before it in the file, so it
 * does not change when line numbers shift. `basis` identifies the checkpoint, the working
 * files, and the index, so a caller can tell that the changes moved. A new file over the
 * large file limit is not in the snapshot; it is listed as added, binary, and too large.
 * A submodule, a change of file type, and a file over `MAX_PATCH_FILE_BYTES` are listed
 * without hunks, so they can only be included whole.
 */
export async function readChanges(ports: EnginePorts): Promise<ChangeSet> {
	return (await readChangesDetailed(ports)).changeSet;
}

/**
 * Like `readChanges`, and also returns the exact bytes of every hunk (key: hunk id) and the
 * working-file tree the changes were read from. `Hunk.patch` in the change set is display
 * text, so it cannot rebuild a file in an encoding other than UTF-8.
 */
export async function readChangesDetailed(ports: EnginePorts): Promise<{ changeSet: ChangeSet; rawHunks: Map<string, Uint8Array>; worktree: string; untrackedLarge: Set<string> }> {
	const base = await baseTreeOf(ports);
	const { tree, skipped } = await worktreeTree(ports);
	const index = await indexTree(ports);
	const large: { path: string; sizeBytes: number; mtimeMs: number }[] = [];
	for (const path of [...skipped].sort()) {
		const info = await ports.files.lstat(path);
		if (info !== undefined) {
			large.push({ path, sizeBytes: info.sizeBytes, mtimeMs: info.mtimeMs });
		}
	}
	const basis = createHash('sha256')
		.update(`${base.head ?? ''}\0${tree}\0${index}`)
		.update(large.map(file => `\0${file.path}\0${file.sizeBytes}\0${file.mtimeMs}`).join(''))
		.digest('hex');

	const flags = [...FIXED_DIFF_CONFIG, '-c', 'diff.ignoreSubmodules=none', 'diff-tree', '-r', '-O/dev/null', '--no-color', '--no-ext-diff', '--no-textconv', '--submodule=short', '-M'];
	const range = [base.tree, tree];
	const names = parseRaw(await mustGit(ports, [...flags, '-z', '--raw', '--no-abbrev', ...range], { binary: true }));

	// A file with a very large version stays out of the patch.
	const baseSizes = await blobSizes(ports, base.tree);
	const workSizes = await blobSizes(ports, tree);
	const tooBigForPatch = (entry: RawEntry) =>
		Math.max(workSizes.get(entry.path) ?? 0, baseSizes.get(entry.oldPath ?? entry.path) ?? 0, baseSizes.get(entry.path) ?? 0) > MAX_PATCH_FILE_BYTES;
	const excluded = names.filter(tooBigForPatch).flatMap(entry => [entry.path, ...(entry.oldPath === undefined ? [] : [entry.oldPath])]);
	const patch = await mustGit(ports, [...flags, '-p', '-U3', '--full-index', ...range, ...(excluded.length === 0 ? [] : ['--', '.', ...excluded.map(path => `:(exclude,literal)${path}`)])], { binary: true });
	const sections = parsePatch(patch);
	// Both lists come from the same diff, so they have the same order. A file replaced by a
	// symbolic link, or the reverse, is one entry in the name list and two sections (a
	// deletion and an addition).
	const expected = names.reduce((total, entry) => total + (tooBigForPatch(entry) ? 0 : entry.typeChange ? 2 : 1), 0);
	if (sections.length !== expected) {
		throw new Error(`git listed ${expected} patches for the changed files but wrote ${sections.length}`);
	}

	const files: ChangedFile[] = [];
	const rawHunks = new Map<string, Uint8Array>();
	let next = 0;
	for (const entry of names) {
		const { status, path, oldPath } = entry;
		const tooBig = tooBigForPatch(entry);
		const section: ParsedSection = tooBig ? { binary: true, hunks: [] } : sections[next];
		next += tooBig ? 0 : entry.typeChange ? 2 : 1;
		// A change of type and a submodule can only be included whole.
		if (entry.typeChange || entry.gitlink) {
			section.binary = true;
			section.hunks = [];
		}
		const seen = new Map<string, number>();
		const hunks = section.hunks.map((parsed): Hunk => {
			const earlier = seen.get(parsed.body) ?? 0;
			seen.set(parsed.body, earlier + 1);
			const { added, removed } = countLines(parsed.body);
			const raw = Buffer.from(`${parsed.headerLine}\n${parsed.body}`, 'latin1');
			const id = hunkId(path, parsed.body, earlier);
			rawHunks.set(id, raw);
			return {
				id,
				header: decodeName(parsed.headerLine),
				addedLines: added,
				removedLines: removed,
				patch: raw.toString('utf8'),
			};
		});
		const info = status === 'deleted' ? undefined : await ports.files.lstat(path);
		const sizeBytes = info?.sizeBytes ?? 0;
		const file: ChangedFile = { path, status, binary: section.binary, sizeBytes, tooLarge: sizeBytes > LARGE_FILE_BYTES, hunks };
		if (oldPath !== undefined) {
			file.oldPath = oldPath;
		}
		files.push(file);
	}
	for (const { path, sizeBytes } of large) {
		files.push({ path, status: 'added', binary: true, sizeBytes, tooLarge: true, hunks: [] });
	}
	return { changeSet: { basis, files }, rawHunks, worktree: tree, untrackedLarge: new Set(large.map(file => file.path)) };
}

/** Quotes a path the way git writes it in a patch header, when it needs quoting. */
function quotePath(path: string): string {
	const bytes = Buffer.from(path, 'utf8');
	if (!bytes.some(byte => byte < 0x20 || byte === 0x22 || byte === 0x5c || byte >= 0x7f)) {
		return path;
	}
	const escapes: Record<number, string> = { 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 0x22: '\\"', 0x5c: '\\\\' };
	let quoted = '"';
	for (const byte of bytes) {
		quoted += escapes[byte] ?? (byte < 0x20 || byte >= 0x7f ? `\\${byte.toString(8).padStart(3, '0')}` : String.fromCharCode(byte));
	}
	return quoted + '"';
}

/** A name in a `---` or `+++` line. Git ends an unquoted name that has a space with a tab. */
function nameLine(path: string): string {
	const quoted = quotePath(path);
	return !quoted.startsWith('"') && quoted.includes(' ') ? `${quoted}\t` : quoted;
}

/** The patch text (one character per byte) that applies the chosen hunks of one file. */
function filePatch(file: ChangedFile, chosen: Hunk[], rawHunks: Map<string, Uint8Array>): string {
	const from = file.oldPath ?? file.path;
	const lines = [`diff --git ${quotePath(`a/${from}`)} ${quotePath(`b/${file.path}`)}`];
	if (file.oldPath !== undefined) {
		lines.push(`rename from ${quotePath(file.oldPath)}`, `rename to ${quotePath(file.path)}`);
	}
	lines.push(`--- ${nameLine(`a/${from}`)}`, `+++ ${nameLine(`b/${file.path}`)}`);
	let text = lines.join('\n') + '\n';
	// An earlier hunk that is left out moves every later line, so the new-side start of each
	// chosen hunk is recomputed from the chosen hunks before it.
	let delta = 0;
	for (const hunk of chosen) {
		const raw = Buffer.from(rawHunks.get(hunk.id) ?? []).toString('latin1');
		const newline = raw.indexOf('\n');
		const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(raw.slice(0, newline));
		if (match === null) {
			throw new Error(`unreadable hunk header: ${hunk.header}`);
		}
		const oldStart = Number(match[1]);
		const oldCount = match[2] === undefined ? 1 : Number(match[2]);
		const newCount = match[4] === undefined ? 1 : Number(match[4]);
		const newStart = newCount === 0 ? oldStart - 1 + delta : oldCount === 0 ? oldStart + 1 + delta : oldStart + delta;
		text += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${match[5]}\n${raw.slice(newline + 1)}`;
		delta += newCount - oldCount;
	}
	return text;
}

/** True when `tree` has an entry at `path`. */
async function inTree(ports: EnginePorts, tree: string, path: string): Promise<boolean> {
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'cat-file', '-e', `${tree}:${path}`]);
	return result.exitCode === 0;
}

/** The entries of `tree` at exactly the given paths (a directory is a `tree` entry). */
async function entriesAt(ports: EnginePorts, tree: string, paths: string[]): Promise<Map<string, { mode: string; oid: string }>> {
	const found = new Map<string, { mode: string; oid: string }>();
	for (let i = 0; i < paths.length; i += 200) {
		const batch = paths.slice(i, i + 200);
		const output = await mustGit(ports, ['--literal-pathspecs', 'ls-tree', '-z', tree, '--', ...batch], { binary: true });
		for (const entry of splitZ(output)) {
			const match = /^(\d+) (\w+) (\w+)\t([\s\S]*)$/.exec(entry);
			if (match !== null && match[2] !== 'tree') {
				found.set(decodeName(match[4]), { mode: match[1], oid: match[3] });
			}
		}
	}
	return found;
}

/**
 * Builds the tree that results from taking `chunk` on top of `baseTree`. The hunks in
 * `chunk.hunkIds` are applied with `git apply --cached` in a temporary index. A file in
 * `chunk.wholeFiles`, and a file whose hunks are all chosen, takes its content and mode from
 * the working-file tree the changes were read from (a renamed file also removes its old
 * path), so a file edited after `readChanges` never enters unreviewed. The hunk of an added
 * or deleted file is the whole file. The only working file read is a new file over the
 * large file limit, which is hashed from disk. Nothing in the project changes.
 * `partialFiles` lists the files from which some hunks were taken and some were left out.
 * Throws `ChunkError` for an unknown hunk id, a repeated hunk id, a file that did not
 * change, or files that changed after `changes` was read.
 */
export async function treeForChunk(
	ports: EnginePorts,
	baseTree: string,
	changes: ChangeSet,
	chunk: Chunk,
): Promise<{ tree: string; partialFiles: string[] }> {
	const owner = new Set<string>();
	for (const file of changes.files) {
		for (const hunk of file.hunks) {
			owner.add(hunk.id);
		}
	}
	const chosenIds = new Set<string>();
	for (const id of chunk.hunkIds) {
		if (!owner.has(id)) {
			throw new ChunkError('unknown-hunk', `unknown hunk ${id}`);
		}
		if (chosenIds.has(id)) {
			throw new ChunkError('repeated-hunk', `hunk ${id} is used twice`);
		}
		chosenIds.add(id);
	}
	const known = new Set(changes.files.map(file => file.path));
	for (const path of chunk.wholeFiles) {
		if (!known.has(path)) {
			throw new ChunkError('unknown-file', `${path} has no changes`);
		}
	}

	// The bytes of the hunks and the content of whole files come from a fresh read, which
	// must still match `changes`.
	const { changeSet: current, rawHunks, worktree, untrackedLarge } = await readChangesDetailed(ports);
	if (current.basis !== changes.basis) {
		throw new ChunkError('changes-moved', 'the files changed after the changes were read');
	}

	const whole = new Set(chunk.wholeFiles);
	const patches: string[] = [];
	const partialFiles: string[] = [];
	for (const file of changes.files) {
		const chosen = file.hunks.filter(hunk => chosenIds.has(hunk.id));
		if (chosen.length === 0 || whole.has(file.path)) {
			continue;
		}
		if (file.status === 'added' || file.status === 'deleted' || chosen.length === file.hunks.length) {
			whole.add(file.path);
			continue;
		}
		// An earlier chunk may already have moved a renamed file.
		const moved = file.oldPath !== undefined && !(await inTree(ports, baseTree, file.oldPath)) && await inTree(ports, baseTree, file.path);
		patches.push(filePatch(moved ? { ...file, oldPath: undefined } : file, chosen, rawHunks));
		partialFiles.push(file.path);
	}

	const wholeFiles = changes.files.filter(file => whole.has(file.path));
	const removed = wholeFiles.flatMap(file => file.oldPath === undefined ? [] : [file.oldPath]);
	// Only an untracked file that the snapshot skipped is read from disk.
	const largeNew = new Set(wholeFiles.filter(file => untrackedLarge.has(file.path)).map(file => file.path));
	const inWorktree = await entriesAt(ports, worktree, wholeFiles.map(file => file.path).filter(path => !largeNew.has(path)));

	const tree = await withTempIndex(ports, async env => {
		await mustGit(ports, ['read-tree', baseTree], { env });
		if (patches.length > 0) {
			await mustGit(ports, ['apply', '--cached', '--whitespace=nowarn'], { env, stdin: Buffer.from(patches.join(''), 'latin1') });
		}
		// Removals come before additions so that a file replacing a directory fits.
		const zero = '0'.repeat(baseTree.length);
		const lines: string[] = [];
		for (const path of [...removed, ...wholeFiles.map(file => file.path).filter(path => !inWorktree.has(path) && !largeNew.has(path))]) {
			lines.push(`0 ${zero}\t${path}\0`);
		}
		for (const [path, entry] of inWorktree) {
			lines.push(`${entry.mode} ${entry.oid}\t${path}\0`);
		}
		for (const path of largeNew) {
			const oid = (await mustGit(ports, ['hash-object', '-w', '--', path], { timeoutMs: 10 * 60_000 })).trim();
			lines.push(`100644 ${oid}\t${path}\0`);
		}
		if (lines.length > 0) {
			await mustGit(ports, ['update-index', '-z', '--index-info'], { env, stdin: lines.join('') });
		}
		return (await mustGit(ports, ['write-tree'], { env })).trim();
	});
	return { tree, partialFiles };
}
