/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { emptyTree } from './changes';
import { readCheckpoints, readCommit, revision } from './checkpoints';
import { findCollisions } from './collisions';
import { mustGit, runGit, splitZ } from './git';
import { PathPlan, readIndexTree, TriState } from './journal';
import { mergeTrees, OverlapPlan, resolveMerge, TEMPORARY_IDENTITY, temporaryCommit } from './mergeTree';
import { EnginePorts } from './ports';
import { fileMode } from './runOperation';
import { STAGING_TIMEOUT_MS, worktreeTree } from './trees';
import { IncomingPreview, OperationResult, Overlap, PathCollision, Resolution } from './types';

export interface ReplayResult {
	clean: boolean;
	/** Present when clean: the branch, index, and working-file trees the project gets. */
	after?: TriState;
	/** Every overlap of the first step that overlaps; empty when clean. */
	overlaps: Overlap[];
	/** The replayed local checkpoints, oldest first. */
	newCommits: string[];
}

/** Runs git in the project root and throws when it exits with an error. */
async function git(ports: EnginePorts, args: string[], options?: Parameters<EnginePorts['git']>[1]): Promise<string> {
	return (await mustGit(ports.git, ['-C', ports.projectRoot, ...args], options)).stdout;
}

/** The project as sync sees it: the commits on both sides and the working files. */
interface SyncContext {
	/** The latest checkpoint, or null in a repository with none. */
	head: string | null;
	headTree: string;
	/** The upstream commit as git last saw it, or undefined when the branch has none. */
	upstream?: string;
	/** The commit both histories share, or a commit of the empty tree when they share none. */
	mergeBase: string;
	/** The local checkpoints not in the upstream, oldest first. */
	local: string[];
	indexTree?: string;
	worktree: { tree: string; skipped: string[] };
}

/** Reads the project for sync. */
async function readContext(ports: EnginePorts): Promise<SyncContext> {
	const head = await revision(ports, 'HEAD') ?? null;
	const upstream = head === null ? undefined : await revision(ports, '@{upstream}');
	const empty = await emptyTree(ports);
	const headTree = head === null ? empty : (await git(ports, ['rev-parse', `${head}^{tree}`])).trim();
	let mergeBase: string | undefined;
	let local: string[] = [];
	if (head !== null && upstream !== undefined) {
		mergeBase = (await runGit(ports.git, ['-C', ports.projectRoot, 'merge-base', head, upstream])).stdout.trim() || undefined;
		local = (await git(ports, ['rev-list', '--reverse', '--first-parent', head, `^${upstream}`, '--'])).split('\n').filter(id => id !== '');
	}
	return {
		head, headTree, upstream, local,
		mergeBase: mergeBase ?? await temporaryCommit(ports, empty, []),
		indexTree: await readIndexTree(ports),
		worktree: await worktreeTree(ports),
	};
}

/**
 * Fetches from the shared copy (spec 6.4). Changes no file, no index, and no local branch; only
 * git's record of the shared copy moves. Returns `done` (with no operation id) or `rejected`
 * with the network port's reason.
 */
export async function checkShared(ports: EnginePorts): Promise<OperationResult> {
	const result = await ports.network.fetch();
	return result.ok ? { kind: 'done', operationId: '', hookEditedFiles: [] } : { kind: 'rejected', reason: result.reason, detail: result.detail };
}

/**
 * Replays the project onto the upstream in the object database (spec 6.4). Nothing visible
 * changes. See `replayContext`.
 */
export async function replay(ports: EnginePorts, resolutions: Resolution[]): Promise<ReplayResult> {
	return (await replayContext(ports, await readContext(ports), resolutions, { final: true })).result;
}

/**
 * Each local checkpoint not in the upstream, oldest first, is replayed with `git merge-tree
 * --write-tree -z --merge-base=<its parent> <new parent> <checkpoint>` and made again with `git
 * commit-tree`: same author, author date, and message; the committer is the person; signed when
 * `commit.gpgsign` is true. A checkpoint whose change the upstream already has is left out. Then
 * the unrecorded changes (the working-file tree, as a commit on HEAD) are replayed the same way
 * onto the new tip, which gives the working files' after tree; the index after tree is the new
 * tip's tree. Hooks do not run.
 *
 * In each step, `ours` (stage 2) is the incoming side. A step that overlaps is resolved with
 * `resolutions` (see `resolveMerge`, which throws `ResolutionRefused`); when an overlap has no
 * resolution, the replay stops there and returns that step's overlaps. With `final` false (a
 * preview), the commits are made unsigned with the engine's own identity as committer, since
 * they only feed the next step.
 */
async function replayContext(
	ports: EnginePorts, context: SyncContext, resolutions: Resolution[], options: { final: boolean },
): Promise<{ result: ReplayResult; plans: OverlapPlan[] }> {
	const newCommits: string[] = [];
	if (context.upstream === undefined) {
		const after = { branchCommit: context.head, indexTree: context.headTree, worktreeTree: context.worktree.tree };
		return { result: { clean: true, after, overlaps: [], newCommits }, plans: [] };
	}
	const authorOf = (paths: string[]) => incomingAuthor(ports, context, paths);
	const sign = options.final && (await runGit(ports.git, ['-C', ports.projectRoot, 'config', '--type=bool', '--get', 'commit.gpgsign'])).stdout.trim() === 'true';
	const empty = await emptyTree(ports);
	let parent = context.upstream;
	let parentTree = (await git(ports, ['rev-parse', `${parent}^{tree}`])).trim();

	for (const commit of context.local) {
		const object = await readCommit(ports, commit);
		const base = object.parents[0] ?? await temporaryCommit(ports, empty, []);
		const baseTree = (await git(ports, ['rev-parse', `${base}^{tree}`])).trim();
		const merge = await mergeTrees(ports, { base, ours: parent, theirs: commit, oursSide: 'theirs', authorOf });
		const tree = await resolveMerge(ports, merge, resolutions, [parentTree, object.tree]);
		if (tree === undefined) {
			return { result: { clean: false, overlaps: merge.plans.map(plan => plan.overlap), newCommits }, plans: merge.plans };
		}
		if (tree === parentTree && object.tree !== baseTree) {
			// The upstream already has this change.
			continue;
		}
		const date = ports.now().toISOString();
		const made = await mustGit(ports.git, [
			'-C', ports.projectRoot, ...(object.encoding === undefined ? [] : ['-c', `i18n.commitEncoding=${object.encoding}`]),
			'commit-tree', tree, '-p', parent, ...(sign ? ['-S'] : ['--no-gpg-sign']),
		], {
			stdin: object.message,
			env: {
				...(options.final ? {} : { GIT_COMMITTER_NAME: TEMPORARY_IDENTITY.GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL: TEMPORARY_IDENTITY.GIT_COMMITTER_EMAIL }),
				GIT_AUTHOR_NAME: object.author.name, GIT_AUTHOR_EMAIL: object.author.email, GIT_AUTHOR_DATE: object.author.date, GIT_COMMITTER_DATE: date,
			},
			timeoutMs: STAGING_TIMEOUT_MS,
		});
		parent = made.stdout.trim();
		parentTree = tree;
		newCommits.push(parent);
	}

	let worktreeAfter = parentTree;
	if (context.worktree.tree !== context.headTree) {
		const head = context.head ?? await temporaryCommit(ports, empty, []);
		const unrecorded = await temporaryCommit(ports, context.worktree.tree, [head]);
		const merge = await mergeTrees(ports, { base: head, ours: parent, theirs: unrecorded, oursSide: 'theirs', authorOf });
		const tree = await resolveMerge(ports, merge, resolutions, [parentTree, context.worktree.tree]);
		if (tree === undefined) {
			return { result: { clean: false, overlaps: merge.plans.map(plan => plan.overlap), newCommits }, plans: merge.plans };
		}
		worktreeAfter = tree;
	}
	return { result: { clean: true, after: { branchCommit: parent, indexTree: parentTree, worktreeTree: worktreeAfter }, overlaps: [], newCommits }, plans: [] };
}

/** The author of the incoming checkpoint that changed any of `paths` last, or an empty string. */
async function incomingAuthor(ports: EnginePorts, context: SyncContext, paths: string[]): Promise<string> {
	if (context.upstream === undefined || paths.length === 0) {
		return '';
	}
	const range = context.head === null ? [context.upstream] : [context.upstream, `^${context.head}`];
	return (await git(ports, ['--literal-pathspecs', 'log', '-1', '--format=%an', ...range, '--', ...paths])).trim();
}

/** The paths that differ between two trees, both names of a rename included. */
async function changedBetween(ports: EnginePorts, left: string, right: string): Promise<string[]> {
	return splitZ(await git(ports, ['diff-tree', '-r', '-z', '--name-only', '--no-renames', left, right]));
}

/** The plans of the files that differ between two working-file trees, as `findCollisions` reads them. */
async function writtenPaths(ports: EnginePorts, before: string, after: string): Promise<PathPlan[]> {
	const fields = splitZ(await git(ports, ['diff-tree', '-r', '-z', '--no-renames', before, after], { timeoutMs: STAGING_TIMEOUT_MS }));
	const plans: PathPlan[] = [];
	for (let index = 0; index + 1 < fields.length; index += 2) {
		// `:<old mode> <new mode> <old blob> <new blob> <status>`, then the path.
		const [oldMode, newMode, oldBlob, newBlob] = fields[index].slice(1).split(' ');
		const beforeMode = fileMode(oldMode);
		const afterMode = fileMode(newMode);
		if (beforeMode !== undefined && afterMode !== undefined) {
			plans.push({ path: fields[index + 1], before: beforeMode === null ? null : oldBlob, after: afterMode === null ? null : newBlob, beforeMode, afterMode });
		}
	}
	return plans;
}

/** The overlaps of the latest preview of each project, so a diff view can show their sides. */
const latestOverlaps = new Map<string, OverlapPlan[]>();

/**
 * The preview of getting the incoming changes (spec 6.4), computed in the object database with
 * `replay`; nothing visible changes. `incoming` lists the checkpoints in the upstream that HEAD
 * does not have (`git log HEAD..@{upstream}`), and `changedPaths` the files they change.
 * `touchesLocalWork` is true when a changed path is also changed by the unrecorded changes or by a
 * local checkpoint not in the upstream. `collisions` lists the files outside every snapshot that
 * the clean result would replace (see `findCollisions`), each with the incoming author; it is
 * empty when the result overlaps. `basis` is `basisOf` over the overlap paths and the collision
 * paths. A branch with no upstream has nothing incoming.
 */
export async function previewIncoming(ports: EnginePorts): Promise<IncomingPreview> {
	return previewContext(ports, await readContext(ports));
}

async function previewContext(ports: EnginePorts, context: SyncContext): Promise<IncomingPreview> {
	if (context.upstream === undefined) {
		latestOverlaps.delete(ports.projectRoot);
		return { basis: await basisOf(ports, [], []), incoming: [], changedPaths: [], touchesLocalWork: false, overlaps: [], collisions: [] };
	}
	const incoming = await readCheckpoints(ports, context.head === null ? [context.upstream] : [context.upstream, `^${context.head}`]);
	const changedPaths = await changedBetween(ports, context.mergeBase, context.upstream);
	const localPaths = new Set([
		...await changedBetween(ports, context.headTree, context.worktree.tree),
		...context.worktree.skipped,
		...(context.head === null ? [] : await changedBetween(ports, context.mergeBase, context.head)),
	]);
	const { result, plans } = await replayContext(ports, context, [], { final: false });
	latestOverlaps.set(ports.projectRoot, plans);

	let collisions: PathCollision[] = [];
	if (result.after !== undefined) {
		const found = await findCollisions(ports, await writtenPaths(ports, context.worktree.tree, result.after.worktreeTree), context.worktree.skipped);
		collisions = [];
		for (const collision of found) {
			const author = await incomingAuthor(ports, context, [collision.path]);
			collisions.push(author === '' ? collision : { ...collision, incomingAuthor: author });
		}
	}
	return {
		basis: await basisOf(ports, overlapPaths(result.overlaps), collisions.map(collision => collision.path)),
		incoming,
		changedPaths,
		touchesLocalWork: changedPaths.some(file => localPaths.has(file)),
		overlaps: result.overlaps,
		collisions,
	};
}

/** Every path an overlap involves. */
function overlapPaths(overlaps: Overlap[]): string[] {
	return overlaps.flatMap(overlap => [overlap.path, ...overlap.otherPaths]);
}

/**
 * The overlap `overlapId` of the latest preview of this project, with its sides, or undefined.
 * When no preview was made yet, one is made.
 */
export async function findOverlap(ports: EnginePorts, overlapId: string): Promise<OverlapPlan | undefined> {
	if (!latestOverlaps.has(ports.projectRoot)) {
		await previewIncoming(ports);
	}
	return latestOverlaps.get(ports.projectRoot)?.find(plan => plan.overlap.id === overlapId);
}

/**
 * The basis token of a preview (spec 6.4): three parts joined by `.`, each the first 16 hex
 * characters of a SHA-256: of the local branch commit (`mine`), of the upstream commit
 * (`shared`), and of the content on disk now of each listed path (`files`, see `diskIds`).
 */
export async function basisOf(ports: EnginePorts, overlapPaths: string[], collisionPaths: string[]): Promise<string> {
	const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
	const head = await revision(ports, 'HEAD') ?? '';
	const upstream = head === '' ? '' : await revision(ports, '@{upstream}') ?? '';
	const files = async (paths: string[]) => {
		const sorted = [...new Set(paths)].sort();
		const ids = await diskIds(ports, sorted);
		return sorted.map((file, index) => `${file}\0${ids[index]}`).join('\0');
	};
	return [hash(head), hash(upstream), hash(`overlaps\0${await files(overlapPaths)}\0collisions\0${await files(collisionPaths)}`)].join('.');
}

/**
 * An id of what is on disk at each path: the blob id of a file's bytes (no filters, nothing
 * written to the object database), `link:<size>:<time>` for a symbolic link, `folder`, or `none`.
 */
async function diskIds(ports: EnginePorts, paths: string[]): Promise<string[]> {
	const ids: string[] = [];
	for (const file of paths) {
		const info = await ports.files.lstat(file);
		if (info === undefined) {
			ids.push('none');
		} else if (info.isDirectory) {
			ids.push('folder');
		} else if (info.isSymbolicLink) {
			ids.push(`link:${info.sizeBytes}:${info.mtimeMs}`);
		} else {
			ids.push((await git(ports, ['hash-object', '--no-filters', '--', file], { timeoutMs: STAGING_TIMEOUT_MS })).trim());
		}
	}
	return ids;
}
