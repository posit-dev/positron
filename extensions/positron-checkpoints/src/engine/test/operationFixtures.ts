/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { splitZ } from '../git';
import { TriState } from '../journal';
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
