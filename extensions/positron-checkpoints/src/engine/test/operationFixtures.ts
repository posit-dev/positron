/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { splitZ } from '../git';
import { engineDirectory, TriState } from '../journal';
import { EnginePorts, GitRunner } from '../ports';
import { OperationPlan } from '../runOperation';
import { worktreeTree } from '../trees';
import { TempRepo } from './tempRepo';

export async function must(repo: TempRepo, args: string[], options?: Parameters<GitRunner>[1]): Promise<string> {
	const result = await repo.git(args, options);
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

/**
 * Builds a tree from `base` with each file of `files` set to its text, or removed when the
 * value is null, without touching the repository's index or working files. A value starting
 * with `link:` is a symbolic link, and one starting with `exec:` is an executable file.
 */
export async function treeWith(repo: TempRepo, base: string, files: Record<string, string | null>): Promise<string> {
	const env = { GIT_INDEX_FILE: path.join(os.tmpdir(), `positron-checkpoints-test-index-${Math.random()}`) };
	try {
		await must(repo, ['read-tree', base], { env });
		for (const [file, value] of Object.entries(files)) {
			if (value === null) {
				await must(repo, ['update-index', '--force-remove', '--', file], { env });
				continue;
			}
			const [mode, text] = value.startsWith('link:') ? ['120000', value.slice(5)] : value.startsWith('exec:') ? ['100755', value.slice(5)] : ['100644', value];
			const blob = await must(repo, ['hash-object', '-w', '--stdin'], { stdin: text });
			await must(repo, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${file}`], { env });
		}
		return await must(repo, ['write-tree'], { env });
	} finally {
		await fsp.rm(env.GIT_INDEX_FILE, { force: true });
	}
}

/** The branch commit, index tree, and working-file tree of the project now, as a plan's `expected`. */
export async function currentState(repo: TempRepo): Promise<TriState> {
	return {
		branchCommit: await must(repo, ['rev-parse', 'refs/heads/main']),
		indexTree: await must(repo, ['write-tree']),
		worktreeTree: (await worktreeTree(repo.ports)).tree,
	};
}

/** True when the ref exists. */
export async function refExists(repo: TempRepo, ref: string): Promise<boolean> {
	return (await repo.git(['rev-parse', '--verify', '-q', ref])).exitCode === 0;
}

/** The three parts of the project as they are now, and the untracked and ignored files. */
export async function projectState(repo: TempRepo) {
	return {
		branch: await must(repo, ['rev-parse', 'refs/heads/main']),
		index: await must(repo, ['write-tree']),
		worktree: (await worktreeTree(repo.ports)).tree,
		untracked: splitZ((await repo.git(['ls-files', '-z', '--others'])).stdout).sort(),
		ignored: await repo.read('debug.log'),
	};
}

/**
 * A project at commit A (a.txt, b.txt, c.txt) with an untracked u.txt and an ignored
 * debug.log, and the plan of an operation that moves it to commit B, which changes three
 * files: a.txt edited, b.txt removed, d.txt added.
 */
export async function referenceProject(repo: TempRepo): Promise<{ a: string; b: string; plan: OperationPlan }> {
	await repo.write('.gitignore', '*.log\n');
	await repo.write('a.txt', 'one\n');
	await repo.write('b.txt', 'bee\n');
	await repo.write('c.txt', 'sea\n');
	const a = await repo.commit('A');
	const treeA = await must(repo, ['rev-parse', 'HEAD^{tree}']);
	const treeB = await treeWith(repo, treeA, { 'a.txt': 'two\n', 'b.txt': null, 'd.txt': 'dee\n' });
	const b = await must(repo, ['commit-tree', treeB, '-p', a, '-m', 'B']);
	await repo.write('u.txt', 'untracked\n');
	await repo.write('debug.log', 'ignored\n');
	const after: TriState = { branchCommit: b, indexTree: treeB, worktreeTree: await treeWith(repo, treeB, { 'u.txt': 'untracked\n' }) };
	return { a, b, plan: { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after, collisionChoices: [] } };
}

/**
 * A project at commit C (a.txt "two\n") whose parent is commit A, on `main`, with an unrecorded
 * edit of a.txt, and the plan of an operation with five ref changes and no file work: create
 * `proposal/x` at C, write its configuration section, point HEAD at it, move `main` back to A
 * (the commit point), and write the engine file `accepted.json`.
 */
export async function refChangeProject(repo: TempRepo): Promise<{ a: string; c: string; plan: OperationPlan }> {
	await repo.write('a.txt', 'one\n');
	const a = await repo.commit('A');
	await repo.write('a.txt', 'two\n');
	const c = await repo.commit('C');
	await repo.write('a.txt', 'two\nunrecorded\n');
	const state = await currentState(repo);
	return {
		a, c, plan: {
			kind: 'check-changed-files', description: 'Change several refs', expected: state, after: state, collisionChoices: [],
			refChanges: [
				{ type: 'ref', name: 'refs/heads/proposal/x', after: c },
				{ type: 'config-section', section: 'branch.proposal/x', before: [], after: [['positronCheckpointsBase', 'main']] },
				{ type: 'head', before: 'refs/heads/main', after: 'refs/heads/proposal/x' },
				{ type: 'ref', name: 'refs/heads/main', before: c, after: a },
				{ type: 'engine-file', name: 'accepted.json', after: '{"branch":"main"}\n' },
			],
			commitPoint: 3,
		},
	};
}

/** One pattern for the mutating call of each change of the `refChangeProject` plan, in order. */
export const REF_CHANGE_CALLS = [
	/^update-ref refs\/heads\/proposal\/x$/,
	/^config branch\.proposal\/x\.positronCheckpointsBase$/,
	/^symbolic-ref HEAD$/,
	/^update-ref refs\/heads\/main$/,
	/^write .*\/positron-checkpoints\/accepted\.json$/,
];

/** What the `refChangeProject` plan changes, with the index and the working files. */
export async function refState(repo: TempRepo) {
	const proposal = await repo.git(['rev-parse', '--verify', '-q', 'refs/heads/proposal/x']);
	const config = await repo.git(['config', '--local', '--get-regexp', '^branch\\.proposal/x\\.']);
	return {
		head: await must(repo, ['symbolic-ref', 'HEAD']),
		main: await must(repo, ['rev-parse', 'refs/heads/main']),
		proposal: proposal.exitCode === 0 ? proposal.stdout.trim() : undefined,
		config: config.stdout,
		engineFile: await fsp.readFile(`${await engineDirectory(repo.ports)}/accepted.json`, 'utf8').catch(() => undefined),
		index: await must(repo, ['write-tree']),
		worktree: (await worktreeTree(repo.ports)).tree,
	};
}

/**
 * A project at commit C whose parent is A, on `main`, where the configuration section
 * `branch.proposal/x` has `remote = origin` and `branch.side` has `remote = origin` and `merge =
 * refs/heads/side`, and the plan of an operation with three ref changes and no file work: write
 * `branch.proposal/x` with three keys, create `refs/heads/proposal/x` at C (the commit point),
 * then write `branch.side` with three other keys.
 */
export async function sectionProject(repo: TempRepo): Promise<{ c: string; plan: OperationPlan }> {
	await repo.write('a.txt', 'one\n');
	await repo.commit('A');
	await repo.write('a.txt', 'two\n');
	const c = await repo.commit('C');
	await must(repo, ['config', '--local', 'branch.proposal/x.remote', 'origin']);
	await must(repo, ['config', '--local', 'branch.side.remote', 'origin']);
	await must(repo, ['config', '--local', 'branch.side.merge', 'refs/heads/side']);
	const state = await currentState(repo);
	return {
		c, plan: {
			kind: 'check-changed-files', description: 'Write two sections', expected: state, after: state, collisionChoices: [],
			refChanges: [
				{
					type: 'config-section', section: 'branch.proposal/x', before: [['remote', 'origin']],
					after: [['positronCheckpointsBase', 'main'], ['remote', 'origin'], ['merge', 'refs/heads/proposal/x']],
				},
				{ type: 'ref', name: 'refs/heads/proposal/x', after: c },
				{
					type: 'config-section', section: 'branch.side', before: [['remote', 'origin'], ['merge', 'refs/heads/side']],
					after: [['remote', 'upstream'], ['merge', 'refs/heads/main'], ['rebase', 'true']],
				},
			],
			commitPoint: 1,
		},
	};
}

/**
 * The `branch.*` configuration (sorted: a section written again moves to the end of the file) and
 * the ref that `sectionProject`'s plan changes, and the index.
 */
export async function sectionState(repo: TempRepo) {
	const proposal = await repo.git(['rev-parse', '--verify', '-q', 'refs/heads/proposal/x']);
	return {
		config: (await must(repo, ['config', '--local', '--list'])).split('\n').filter(line => line.startsWith('branch.')).sort(),
		proposal: proposal.exitCode === 0 ? proposal.stdout.trim() : undefined,
		index: await must(repo, ['write-tree']),
	};
}

/** The `branch.*` configuration that `sectionProject`'s plan leads to, sorted. */
export const SECTION_AFTER = [
	'branch.proposal/x.positroncheckpointsbase=main', 'branch.proposal/x.remote=origin', 'branch.proposal/x.merge=refs/heads/proposal/x',
	'branch.side.remote=upstream', 'branch.side.merge=refs/heads/main', 'branch.side.rebase=true',
].sort();

/** Ports whose journal runs `fn` once, right after the operation's record is written. */
export function afterJournal(ports: EnginePorts, fn: () => Promise<void>): EnginePorts {
	let done = false;
	return {
		...ports,
		files: {
			...ports.files,
			appendDurable: async (file, line) => {
				await ports.files.appendDurable(file, line);
				if (!done && line.includes('"type":"record"')) {
					done = true;
					await fn();
				}
			},
		},
	};
}

/**
 * The reference project (with its ignored debug.log, "ignored\n") and a plan whose after state
 * also has an incoming debug.log, "incoming\n".
 */
export async function collidingProject(repo: TempRepo): Promise<{ a: string; plan: OperationPlan }> {
	const { a, plan } = await referenceProject(repo);
	const indexTree = await treeWith(repo, plan.after.indexTree, { 'debug.log': 'incoming\n' });
	const branchCommit = await must(repo, ['commit-tree', indexTree, '-p', a, '-m', 'B with debug.log']);
	const worktree = await treeWith(repo, plan.after.worktreeTree, { 'debug.log': 'incoming\n' });
	return { a, plan: { ...plan, after: { branchCommit, indexTree, worktreeTree: worktree } } };
}

/**
 * A project at commit A (a.txt, out/tracked.txt) with the ignored debug.log, an untracked u.txt,
 * and an ignored out/run.log ("mine\n"), and the plan of an operation to commit B, where `out`
 * is a file. The plan removes out/tracked.txt and collides with out/run.log.
 */
export async function folderCollidingProject(repo: TempRepo): Promise<{ a: string; plan: OperationPlan }> {
	await repo.write('.gitignore', '*.log\n');
	await repo.write('a.txt', 'one\n');
	await repo.write('out/tracked.txt', 'tracked\n');
	const a = await repo.commit('A');
	await repo.write('debug.log', 'ignored\n');
	await repo.write('u.txt', 'untracked\n');
	await repo.write('out/run.log', 'mine\n');
	const indexTree = await treeWith(repo, await must(repo, ['rev-parse', 'HEAD^{tree}']), { 'out/tracked.txt': null, out: 'a file now\n' });
	const branchCommit = await must(repo, ['commit-tree', indexTree, '-p', a, '-m', 'B']);
	const worktree = await treeWith(repo, indexTree, { 'u.txt': 'untracked\n' });
	return { a, plan: { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after: { branchCommit, indexTree, worktreeTree: worktree }, collisionChoices: [] } };
}
