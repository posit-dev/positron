/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { emptyTree } from './changes';
import { readCheckpoints, readCommit, readPartialFiles, revision, savePartialFiles } from './checkpoints';
import { findCollisions } from './collisions';
import { mustGit, runGit, splitZ } from './git';
import { PathPlan, readBranch, readIndexTree, TriState } from './journal';
import { mergeTrees, OverlapPlan, ResolutionRefused, resolveMerge, TEMPORARY_IDENTITY, temporaryCommit } from './mergeTree';
import { noteNewOperation } from './operationLog';
import { EnginePorts } from './ports';
import { isSyncAvailable } from './repoState';
import { fileMode, runOperation } from './runOperation';
import { LARGE_FILE_BYTES, STAGING_TIMEOUT_MS, worktreeTree } from './trees';
import { CollisionChoice, IncomingPreview, OperationResult, Overlap, PathCollision, Resolution } from './types';

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
 * `commit.gpgsign` is true; with `final`, each made checkpoint gets the partial-file record of the
 * checkpoint it replays. A checkpoint whose change the upstream already has is left out. Then
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
	const partial = options.final ? await readPartialFiles(ports) : new Map<string, string[]>();
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
		await savePartialFiles(ports, parent, partial.get(commit) ?? []);
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
 * The basis token of a preview (spec 6.4), four parts joined by `.`: the first 16 hex characters
 * of a SHA-256 of the local branch commit (`mine`), of the upstream commit (`shared`), and of the
 * content on disk now of each listed path (`files`, see `diskIds`), then the listed paths
 * themselves (base64url JSON), so a later check compares the content of the paths that were
 * reviewed (see `basisDifference`).
 */
export async function basisOf(ports: EnginePorts, overlapPaths: string[], collisionPaths: string[]): Promise<string> {
	const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
	const head = await revision(ports, 'HEAD') ?? '';
	const upstream = head === '' ? '' : await revision(ports, '@{upstream}') ?? '';
	const [overlaps, collisions] = [[...new Set(overlapPaths)].sort(), [...new Set(collisionPaths)].sort()];
	const files = async (paths: string[]) => {
		const ids = await diskIds(ports, paths);
		return paths.map((file, index) => `${file}\0${ids[index]}`).join('\0');
	};
	return [
		hash(head),
		hash(upstream),
		hash(`overlaps\0${await files(overlaps)}\0collisions\0${await files(collisions)}`),
		Buffer.from(JSON.stringify([overlaps, collisions]), 'utf8').toString('base64url'),
	].join('.');
}

/**
 * The parts of the reviewed basis that no longer hold, by name: `mine` and `shared` when the
 * local branch or the upstream moved, and `files` when a path the reviewed basis lists has other
 * content on disk now. A token that cannot be read differs in every part.
 */
async function basisDifference(ports: EnginePorts, reviewed: string): Promise<('mine' | 'shared' | 'files')[]> {
	const [mine, shared, files, listed] = reviewed.split('.');
	let paths: [string[], string[]] | undefined;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(listed ?? '', 'base64url').toString('utf8'));
		if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(list => Array.isArray(list) && list.every((file: unknown) => typeof file === 'string'))) {
			paths = parsed as [string[], string[]];
		}
	} catch {
		// An unreadable token differs in every part.
	}
	if (paths === undefined) {
		return ['mine', 'shared', 'files'];
	}
	const [nowMine, nowShared, nowFiles] = (await basisOf(ports, paths[0], paths[1])).split('.');
	return [mine !== nowMine ? 'mine' : undefined, shared !== nowShared ? 'shared' : undefined, files !== nowFiles ? 'files' : undefined]
		.filter((part): part is 'mine' | 'shared' | 'files' => part !== undefined);
}

/**
 * An id of what is on disk at each path: the blob id of a file's bytes (no filters, nothing
 * written to the object database), `link:<size>:<time>` for a symbolic link, `folder:<hash>`
 * for a folder (see `folderId`), or `none`.
 */
async function diskIds(ports: EnginePorts, paths: string[]): Promise<string[]> {
	const ids: string[] = [];
	for (const file of paths) {
		const info = await ports.files.lstat(file);
		if (info === undefined) {
			ids.push('none');
		} else if (info.isDirectory) {
			ids.push(`folder:${await folderId(ports, file)}`);
		} else if (info.isSymbolicLink) {
			ids.push(`link:${info.sizeBytes}:${info.mtimeMs}`);
		} else {
			ids.push((await git(ports, ['hash-object', '--no-filters', '--', file], { timeoutMs: STAGING_TIMEOUT_MS })).trim());
		}
	}
	return ids;
}

/**
 * A SHA-256 over every file in `folder`: each file git would store (tracked, or untracked and
 * not ignored) with its blob id as git would store it, and each ignored file and each untracked
 * file over `LARGE_FILE_BYTES` with its size. A symbolic link counts by its size and time, and a
 * missing tracked file as `none`. Nothing is written to the object database.
 */
async function folderId(ports: EnginePorts, folder: string): Promise<string> {
	const pathspec = `:(literal)${folder}/`;
	const tracked = splitZ(await git(ports, ['ls-files', '-z', '--cached', '--', pathspec]));
	const untracked = splitZ(await git(ports, ['ls-files', '-z', '--others', '--exclude-standard', '--', pathspec]));
	const ignored = splitZ(await git(ports, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', pathspec]));
	const entries = new Map<string, string>();
	const hashed: string[] = [];
	for (const [files, stored] of [[tracked, true], [untracked, true], [ignored, false]] as const) {
		for (const file of files) {
			const info = await ports.files.lstat(file);
			if (info === undefined) {
				entries.set(file, 'none');
			} else if (info.isSymbolicLink || info.isDirectory) {
				entries.set(file, `entry:${info.isDirectory}:${info.sizeBytes}:${info.mtimeMs}`);
			} else if (!stored || (files === untracked && info.sizeBytes > LARGE_FILE_BYTES)) {
				entries.set(file, `size:${info.sizeBytes}`);
			} else {
				hashed.push(file);
			}
		}
	}
	for (let start = 0; start < hashed.length; start += 200) {
		const batch = hashed.slice(start, start + 200);
		const blobs = (await git(ports, ['hash-object', '--', ...batch], { timeoutMs: STAGING_TIMEOUT_MS })).split('\n').filter(line => line !== '');
		batch.forEach((file, index) => entries.set(file, blobs[index] ?? ''));
	}
	const hash = createHash('sha256');
	for (const file of [...entries.keys()].sort()) {
		hash.update(`${file}\0${entries.get(file)}\0`);
	}
	return hash.digest('hex').slice(0, 16);
}

/** `Get changes from <names>`, with the authors of the incoming checkpoints other than the person. */
function describeGet(preview: IncomingPreview): string {
	const names = [...new Set(preview.incoming.filter(checkpoint => !checkpoint.authorIsMe).map(checkpoint => checkpoint.authorName))];
	return names.length === 0 ? 'Get changes' : `Get changes from ${names.join(', ')}`;
}

/**
 * Gets the incoming changes (spec 6.4), only as the person approved them:
 *
 * 1. `unavailable git-too-old` when git lacks `merge-tree --merge-base`; `rejected
 *    no-shared-copy` when the branch has no upstream; `unavailable unusual-state staged-work`
 *    when the index differs from HEAD (work staged by another tool).
 * 2. The preview is computed again. When a part of `basis` no longer holds (`basisDifference`:
 *    the local branch, the upstream, or the content of a reviewed overlap or collision path),
 *    nothing changes and the result is `inputs-changed`, naming each such part, with the fresh
 *    preview. Edits to other files do not count: they are replayed fresh in step 4.
 * 3. `unavailable nothing-to-do` when nothing is incoming.
 * 4. `replay(resolutions)`. A resolution the overlap does not allow, or cannot use, gives
 *    `inputs-changed` with no part named and the fresh preview. An overlap with no resolution
 *    (including one that edits made since the review produced) gives `overlaps`, with the
 *    overlaps of the step that stopped and a basis over their paths.
 * 5. A clean result is applied through `runOperation` as `get-changes`: files and index first,
 *    the branch last, with `collisionChoices` for files outside every snapshot. The new
 *    operation is noted in the undo list.
 *
 * A failure before `runOperation` starts changes nothing and gives `could-not-finish`.
 */
export async function getIncoming(ports: EnginePorts, basis: string, resolutions: Resolution[], collisionChoices: CollisionChoice[]): Promise<OperationResult> {
	let plan: { expected: TriState; after: TriState; description: string };
	try {
		if (!await isSyncAvailable(ports)) {
			return { kind: 'unavailable', reason: 'git-too-old' };
		}
		const context = await readContext(ports);
		if (context.upstream === undefined) {
			return { kind: 'rejected', reason: 'no-shared-copy', detail: 'The branch has no shared copy.' };
		}
		if (context.indexTree !== context.headTree) {
			return { kind: 'unavailable', reason: 'unusual-state', detail: 'staged-work' };
		}
		const preview = await previewContext(ports, context);
		const changed = await basisDifference(ports, basis);
		if (changed.length > 0) {
			return { kind: 'inputs-changed', changed, preview };
		}
		if (preview.incoming.length === 0) {
			return { kind: 'unavailable', reason: 'nothing-to-do' };
		}
		let replayed: Awaited<ReturnType<typeof replayContext>>;
		try {
			replayed = await replayContext(ports, context, resolutions, { final: true });
		} catch (error) {
			if (error instanceof ResolutionRefused) {
				return { kind: 'inputs-changed', changed: [], preview };
			}
			throw error;
		}
		if (replayed.result.after === undefined) {
			latestOverlaps.set(ports.projectRoot, replayed.plans);
			// A later step may stop at other overlaps than the preview's first step, so the basis binds the ones reported.
			const reported = replayed.result.overlaps;
			return { kind: 'overlaps', preview: { ...preview, basis: await basisOf(ports, overlapPaths(reported), []), overlaps: reported, collisions: [] } };
		}
		plan = {
			expected: { branchCommit: context.head, indexTree: context.indexTree, worktreeTree: context.worktree.tree },
			after: replayed.result.after,
			description: describeGet(preview),
		};
	} catch (error) {
		return { kind: 'could-not-finish', detail: error instanceof Error ? error.message : String(error) };
	}
	const result = await runOperation(ports, { kind: 'get-changes', ...plan, collisionChoices });
	if (result.kind === 'done') {
		latestOverlaps.delete(ports.projectRoot);
		await noteNewOperation(ports, 'get-changes');
	}
	return result;
}

/**
 * Sends the local checkpoints to the shared copy with `ports.network.push`. Returns `rejected
 * no-shared-copy` when the branch has no upstream, `unavailable nothing-to-do` when no local
 * checkpoint is ahead of it, and `rejected` with the port's reason when the push fails. After a
 * push, the record of the shared copy is refreshed (as `checkShared` does), a `send-changes`
 * operation is recorded, and both lists are cleared (spec 6.3). The result is `done` with that
 * operation's id, or with no id when the record could not be written; the push happened either way.
 */
export async function sendChanges(ports: EnginePorts): Promise<OperationResult> {
	const symbolic = await runGit(ports.git, ['-C', ports.projectRoot, 'symbolic-ref', '-q', 'HEAD']);
	const ref = symbolic.exitCode === 0 ? symbolic.stdout.trim() : '';
	if (!ref.startsWith('refs/heads/')) {
		return { kind: 'unavailable', reason: 'unusual-state' };
	}
	const branch = ref.slice('refs/heads/'.length);
	const upstream = await revision(ports, '@{upstream}');
	if (upstream === undefined) {
		return { kind: 'rejected', reason: 'no-shared-copy', detail: 'The branch has no shared copy.' };
	}
	const head = await revision(ports, 'HEAD');
	const ahead = head === undefined ? 0 : Number((await git(ports, ['rev-list', '--count', head, `^${upstream}`, '--'])).trim());
	if (ahead === 0) {
		return { kind: 'unavailable', reason: 'nothing-to-do' };
	}
	const pushed = await ports.network.push(branch);
	if (!pushed.ok) {
		return { kind: 'rejected', reason: pushed.reason, detail: pushed.detail };
	}
	// A port that pushes without updating git's record of the shared copy leaves it behind.
	await checkShared(ports);

	let operationId = '';
	try {
		const indexTree = await readIndexTree(ports);
		if (indexTree !== undefined) {
			const state: TriState = { branchCommit: await readBranch(ports, branch), indexTree, worktreeTree: (await worktreeTree(ports)).tree };
			const recorded = await runOperation(ports, { kind: 'send-changes', description: 'Send changes', expected: state, after: state, collisionChoices: [] });
			operationId = recorded.kind === 'done' ? recorded.operationId : '';
		}
	} catch {
		// The push happened; only its record is missing.
	}
	// The states before the push can no longer be reached safely, whether or not the record exists.
	await noteNewOperation(ports, 'send-changes');
	return { kind: 'done', operationId, hookEditedFiles: [] };
}
