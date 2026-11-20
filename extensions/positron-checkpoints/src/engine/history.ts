/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { emptyTree, parseRaw } from './changes';
import { readPartialFiles, readPendingTrees, resolveCommit } from './checkpoints';
import { mustGit, runGit, splitZ } from './git';
import { EnginePorts } from './ports';
import { LARGE_FILE_BYTES } from './trees';
import { ChangedFile, Checkpoint, ContentRef, DiffTarget } from './types';

/** A full object id. `readBlob` reads nothing else, so its argument is never taken for an option. */
const FULL_OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;

/** A tree or commit id from a caller; anything else is never passed to git. */
const OBJECT_ID = /^[0-9a-f]{4,64}$/i;

const EMPTY: ContentRef = { kind: 'empty' };

/** Runs git in the project root and throws when it exits with an error. */
async function git(ports: EnginePorts, args: string[], options?: Parameters<EnginePorts['git']>[1]): Promise<string> {
	return (await mustGit(ports.git, ['-C', ports.projectRoot, ...args], options)).stdout;
}

/** The commit `rev` names, or undefined when it names none. `rev` comes from the engine. */
async function revision(ports: EnginePorts, rev: string): Promise<string | undefined> {
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', '--end-of-options', `${rev}^{commit}`]);
	return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

/**
 * The checkpoints of the current branch, newest first, following first parents only, from
 * `skip` for at most `limit` entries. `shared` is true for a checkpoint in the upstream as git
 * last saw it (with no upstream, nothing is shared). `authorIsMe` is true when the author's
 * email equals `user.email`, ignoring case. The title is the first line of the message and the
 * body the rest, without the blank line between them. `time` is the author time. A repository
 * with no checkpoints has an empty history.
 */
export async function getHistory(ports: EnginePorts, skip: number, limit: number): Promise<Checkpoint[]> {
	const count = Math.floor(limit);
	const head = await revision(ports, 'HEAD');
	if (head === undefined || !(count > 0)) {
		return [];
	}
	const output = await git(ports, [
		'log', '--first-parent', '-z', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B',
		`--skip=${Math.max(0, Math.floor(skip) || 0)}`, `--max-count=${count}`, head, '--',
	]);
	const upstream = await revision(ports, '@{upstream}');
	const unshared = upstream === undefined ? undefined : new Set((await git(ports, ['rev-list', head, `^${upstream}`, '--'])).split('\n').filter(id => id !== ''));
	const me = (await runGit(ports.git, ['-C', ports.projectRoot, 'config', '--get', 'user.email'])).stdout.trim().toLowerCase();
	const partial = await readPartialFiles(ports);

	return splitZ(output).map(entry => {
		const [id, authorName, email, time, message] = entry.split('\x1f');
		const [title, ...rest] = message.replace(/\s+$/, '').split('\n');
		return {
			id, title, body: rest.join('\n').replace(/^\n+/, ''),
			authorName, authorIsMe: me !== '' && email.toLowerCase() === me, time: new Date(time).toISOString(),
			shared: unshared !== undefined && !unshared.has(id), partialFiles: partial.get(id) ?? [],
		};
	});
}

/** The blob at exactly `file` in `treeish`, or empty when there is none (a missing path, a folder, or a submodule). */
async function blobAt(ports: EnginePorts, treeish: string | undefined, file: string): Promise<ContentRef> {
	if (treeish === undefined) {
		return EMPTY;
	}
	const output = await git(ports, ['--literal-pathspecs', 'ls-tree', '-z', treeish, '--', file], { binary: true });
	for (const entry of splitZ(output)) {
		const match = /^\d+ (?<type>\w+) (?<oid>\w+)\t(?<name>[\s\S]*)$/.exec(entry);
		if (match?.groups !== undefined && match.groups.type === 'blob' && Buffer.from(match.groups.name, 'latin1').toString('utf8') === file) {
			return { kind: 'blob', oid: match.groups.oid };
		}
	}
	return EMPTY;
}

/** The first parent of `commit`, or undefined for a first checkpoint. */
async function firstParent(ports: EnginePorts, commit: string): Promise<string | undefined> {
	return revision(ports, `${commit}^1`);
}

/** The raw differences between two trees, with renames found. */
async function rawDifferences(ports: EnginePorts, left: string, right: string) {
	return parseRaw(await git(ports, ['diff-tree', '-r', '-z', '--raw', '--no-abbrev', '-M', left, right], { binary: true }));
}

/**
 * The two sides of one file for a diff view. A side that does not exist is `empty`.
 *
 * - `change`: the blob at HEAD, and the working file.
 * - `checkpoint`: the blob in the checkpoint's first parent (at the old path when the
 *   checkpoint renamed the file), and the blob in the checkpoint.
 * - `incoming`: the blob in the merge base of HEAD and the upstream, and the blob in the upstream.
 * - `trees`: the blob in each tree.
 * - `pending`: the blob in the approved tree of the pending approval, and the blob in the tree
 *   the project's hooks left.
 */
export async function getDiff(ports: EnginePorts, target: DiffTarget): Promise<{ left: ContentRef; right: ContentRef }> {
	switch (target.kind) {
		case 'change': {
			const info = await ports.files.lstat(target.path);
			return {
				left: await blobAt(ports, await revision(ports, 'HEAD'), target.path),
				right: info === undefined || info.isDirectory ? EMPTY : { kind: 'file', path: target.path },
			};
		}
		case 'checkpoint': {
			const commit = await resolveCommit(ports, target.id);
			if (commit === undefined) {
				return { left: EMPTY, right: EMPTY };
			}
			const parent = await firstParent(ports, commit);
			const base = parent ?? await emptyTree(ports);
			const renamed = (await rawDifferences(ports, base, commit)).find(entry => entry.path === target.path)?.oldPath;
			return { left: await blobAt(ports, parent, renamed ?? target.path), right: await blobAt(ports, commit, target.path) };
		}
		case 'incoming': {
			const upstream = await revision(ports, '@{upstream}');
			const head = await revision(ports, 'HEAD');
			const base = upstream === undefined || head === undefined
				? undefined
				: (await runGit(ports.git, ['-C', ports.projectRoot, 'merge-base', head, upstream])).stdout.trim() || undefined;
			return { left: await blobAt(ports, base, target.path), right: await blobAt(ports, upstream, target.path) };
		}
		case 'trees': {
			const side = (id: string) => OBJECT_ID.test(id) ? id : undefined;
			return { left: await blobAt(ports, side(target.left), target.path), right: await blobAt(ports, side(target.right), target.path) };
		}
		case 'pending': {
			const trees = await readPendingTrees(ports, target.token);
			return { left: await blobAt(ports, trees?.approvedTree, target.path), right: await blobAt(ports, trees?.resultTree, target.path) };
		}
	}
}

/** The exact bytes of the blob `oid`, which must be a full object id. */
export async function readBlob(ports: EnginePorts, oid: string): Promise<Uint8Array> {
	if (!FULL_OBJECT_ID.test(oid)) {
		throw new Error(`not an object id: ${oid}`);
	}
	return Buffer.from(await git(ports, ['cat-file', 'blob', oid], { binary: true, timeoutMs: 10 * 60_000 }), 'latin1');
}

/**
 * The files that differ between two trees, without hunk text. A file is binary when git
 * counts no lines for it, and a submodule is always binary. `sizeBytes` is the size of the
 * right side, or of the left side for a deleted file.
 */
async function filesBetween(ports: EnginePorts, left: string, right: string): Promise<ChangedFile[]> {
	const entries = await rawDifferences(ports, left, right);
	if (entries.length === 0) {
		return [];
	}
	// `<added>\t<removed>\t<path>`, or for a rename `<added>\t<removed>\t`, the old path, and the new path.
	const binary = new Set<string>();
	const counts = splitZ(await git(ports, ['diff-tree', '-r', '-z', '--numstat', '-M', left, right], { binary: true }));
	for (let index = 0; index < counts.length;) {
		const match = /^(?<added>-|\d+)\t(?<removed>-|\d+)\t(?<name>[\s\S]*)$/.exec(counts[index++]);
		if (match?.groups === undefined) {
			continue;
		}
		let name = match.groups.name;
		if (name === '') {
			name = counts[index + 1] ?? '';
			index += 2;
		}
		if (match.groups.added === '-') {
			binary.add(Buffer.from(name, 'latin1').toString('utf8'));
		}
	}
	const objects = entries.map(entry => entry.status === 'deleted' ? entry.oldObject : entry.newObject);
	const sizes = (await git(ports, ['cat-file', '--batch-check=%(objectsize)'], { stdin: objects.join('\n') + '\n' })).split('\n');
	return entries.map((entry, index): ChangedFile => {
		const sizeBytes = entry.gitlink || !/^\d+$/.test(sizes[index] ?? '') ? 0 : Number(sizes[index]);
		const file: ChangedFile = {
			path: entry.path, status: entry.status, binary: entry.gitlink || binary.has(entry.path),
			sizeBytes, tooLarge: sizeBytes > LARGE_FILE_BYTES, hunks: [],
		};
		if (entry.oldPath !== undefined) {
			file.oldPath = entry.oldPath;
		}
		return file;
	});
}

/** The files the checkpoint `id` changed against its first parent (the empty tree for a first checkpoint). An unknown id has none. */
export async function getCheckpointFiles(ports: EnginePorts, id: string): Promise<ChangedFile[]> {
	const commit = await resolveCommit(ports, id);
	if (commit === undefined) {
		return [];
	}
	return filesBetween(ports, await firstParent(ports, commit) ?? await emptyTree(ports), commit);
}

/** The files that differ between the approved tree and the tree the hooks left, of the pending approval `token`. An unknown token has none. */
export async function getPendingFiles(ports: EnginePorts, token: string): Promise<ChangedFile[]> {
	const trees = await readPendingTrees(ports, token);
	return trees === undefined ? [] : filesBetween(ports, trees.approvedTree, trees.resultTree);
}
