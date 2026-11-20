/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { mustGit as mustGitRunner, runGit, splitZ } from './git';
import { EnginePorts } from './ports';
import { indexTree, LARGE_FILE_BYTES, withTempIndex, worktreeTree } from './trees';
import { ChangedFile, ChangeSet, Chunk, Hunk } from './types';

/** The tree git knows without storing it: the tree with no files. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Hunk ids are the first 16 hex characters of a SHA-256. */
const HUNK_ID_LENGTH = 16;

/** A chunk names a hunk that does not exist, names a hunk twice, or names a file that did not change. */
export class ChunkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChunkError';
	}
}

/**
 * The text of a hunk's patch. `Hunk.patch` holds the exact bytes of the hunk, one character
 * per byte (latin1), so that a file in any encoding can be applied again without change.
 */
export function hunkText(hunk: Hunk): string {
	return Buffer.from(hunk.patch, 'latin1').toString('utf8');
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

interface NameStatus { status: ChangedFile['status']; path: string; oldPath?: string }

/** Parses `git diff --name-status -z`, whose paths are exact (never quoted). */
function parseNameStatus(output: string): NameStatus[] {
	const parts = splitZ(output);
	const entries: NameStatus[] = [];
	for (let i = 0; i < parts.length;) {
		const code = parts[i++];
		if (code.startsWith('R') || code.startsWith('C')) {
			const oldPath = decodeName(parts[i++]);
			entries.push({ status: 'renamed', path: decodeName(parts[i++]), oldPath });
		} else {
			const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
			entries.push({ status, path: decodeName(parts[i++]) });
		}
	}
	return entries;
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

/** The tree a change is measured against: the latest checkpoint, or the empty tree. */
async function baseTreeOf(ports: EnginePorts): Promise<{ head?: string; tree: string }> {
	const head = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', 'HEAD']);
	if (head.exitCode !== 0) {
		return { tree: EMPTY_TREE };
	}
	const commit = head.stdout.trim();
	return { head: commit, tree: (await mustGit(ports, ['rev-parse', `${commit}^{tree}`])).trim() };
}

/**
 * Lists the files that differ between the latest checkpoint (or the empty tree when there is
 * none) and the working files, with the hunks of each text file. A hunk id depends on the
 * path, the hunk's lines, and how many identical hunks come before it in the file, so it
 * does not change when line numbers shift. `basis` identifies the checkpoint, the working
 * files, and the index, so a caller can tell that the changes moved.
 */
export async function readChanges(ports: EnginePorts): Promise<ChangeSet> {
	const base = await baseTreeOf(ports);
	const { tree } = await worktreeTree(ports);
	const index = await indexTree(ports);
	const basis = createHash('sha256').update(`${base.head ?? ''}\0${tree}\0${index}`).digest('hex');

	const flags = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U3', '-M'];
	const range = [base.tree, tree];
	const names = parseNameStatus((await mustGit(ports, [...flags, '--name-status', '-z', ...range], { binary: true })));
	const patch = await mustGit(ports, [...flags, '--full-index', ...range], { binary: true });
	const sections = parsePatch(patch);
	if (sections.length !== names.length) {
		throw new Error(`git listed ${names.length} changed files but ${sections.length} patches`);
	}

	const files: ChangedFile[] = [];
	for (let i = 0; i < names.length; i++) {
		const { status, path, oldPath } = names[i];
		const section = sections[i];
		const seen = new Map<string, number>();
		const hunks = section.hunks.map((parsed): Hunk => {
			const earlier = seen.get(parsed.body) ?? 0;
			seen.set(parsed.body, earlier + 1);
			const { added, removed } = countLines(parsed.body);
			return {
				id: hunkId(path, parsed.body, earlier),
				header: decodeName(parsed.headerLine),
				addedLines: added,
				removedLines: removed,
				patch: `${parsed.headerLine}\n${parsed.body}`,
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
	return { basis, files };
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
function filePatch(file: ChangedFile, chosen: Hunk[]): string {
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
		const newline = hunk.patch.indexOf('\n');
		const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(hunk.patch.slice(0, newline));
		if (match === null) {
			throw new Error(`unreadable hunk header: ${hunk.header}`);
		}
		const oldStart = Number(match[1]);
		const oldCount = match[2] === undefined ? 1 : Number(match[2]);
		const newCount = match[4] === undefined ? 1 : Number(match[4]);
		const newStart = newCount === 0 ? oldStart - 1 + delta : oldCount === 0 ? oldStart + 1 + delta : oldStart + delta;
		text += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${match[5]}\n${hunk.patch.slice(newline + 1)}`;
		delta += newCount - oldCount;
	}
	return text;
}

/**
 * Builds the tree that results from taking `chunk` on top of `baseTree`. The hunks in
 * `chunk.hunkIds` are applied with `git apply --cached` in a temporary index, and the files
 * in `chunk.wholeFiles` are added, changed, or removed to match the working files (a
 * renamed file also removes its old path). The hunk of an added or deleted file is the whole
 * file, so choosing it is the same as listing the file. Nothing in the project changes.
 * `partialFiles` lists the files from which some hunks were taken and some were left out.
 * Throws `ChunkError` for an unknown hunk id, a repeated hunk id, or a file that did not change.
 */
export async function treeForChunk(
	ports: EnginePorts,
	baseTree: string,
	changes: ChangeSet,
	chunk: Chunk,
): Promise<{ tree: string; partialFiles: string[] }> {
	const owner = new Map<string, { file: ChangedFile; hunk: Hunk }>();
	for (const file of changes.files) {
		for (const hunk of file.hunks) {
			owner.set(hunk.id, { file, hunk });
		}
	}
	const chosenIds = new Set<string>();
	for (const id of chunk.hunkIds) {
		if (!owner.has(id)) {
			throw new ChunkError(`unknown hunk ${id}`);
		}
		if (chosenIds.has(id)) {
			throw new ChunkError(`hunk ${id} is used twice`);
		}
		chosenIds.add(id);
	}
	const known = new Set(changes.files.map(file => file.path));
	for (const path of chunk.wholeFiles) {
		if (!known.has(path)) {
			throw new ChunkError(`${path} has no changes`);
		}
	}

	const whole = new Set(chunk.wholeFiles);
	const patches: string[] = [];
	const partialFiles: string[] = [];
	for (const file of changes.files) {
		const chosen = file.hunks.filter(hunk => chosenIds.has(hunk.id));
		if (chosen.length === 0 || whole.has(file.path)) {
			continue;
		}
		if (file.status === 'added' || file.status === 'deleted') {
			whole.add(file.path);
			continue;
		}
		patches.push(filePatch(file, chosen));
		if (chosen.length < file.hunks.length) {
			partialFiles.push(file.path);
		}
	}

	const paths: string[] = [];
	for (const file of changes.files) {
		if (whole.has(file.path)) {
			paths.push(file.path);
			if (file.oldPath !== undefined) {
				paths.push(file.oldPath);
			}
		}
	}

	const tree = await withTempIndex(ports, async env => {
		await mustGit(ports, ['read-tree', baseTree], { env });
		if (patches.length > 0) {
			await mustGit(ports, ['apply', '--cached', '--whitespace=nowarn'], { env, stdin: Buffer.from(patches.join(''), 'latin1') });
		}
		if (paths.length > 0) {
			await mustGit(ports, ['--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
				env,
				stdin: paths.join('\0') + '\0',
				timeoutMs: 10 * 60_000,
			});
		}
		return (await mustGit(ports, ['write-tree'], { env })).trim();
	});
	return { tree, partialFiles };
}
