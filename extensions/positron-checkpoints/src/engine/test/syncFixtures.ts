/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as path from 'path';
import { checkShared } from '../sync';
import { worktreeTree } from '../trees';
import { OverlapKind } from '../types';
import { must } from './operationFixtures';
import { tempRepo, TempRepo } from './tempRepo';

/** The ten lines of a.txt at checkpoint A. */
export const LINES = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);

export const text = (lines: string[]) => lines.join('\n') + '\n';

/** a.txt with line `index` replaced by `value`. */
export const withLine = (index: number, value: string) => text(LINES.map((line, at) => at === index ? value : line));

export interface SharedProject { repo: TempRepo; maya: TempRepo; a: string }

/**
 * A project at checkpoint A (a.txt with ten lines, b.txt, .gitignore for *.csv, and `files`)
 * shared with a colleague, Maya, who works in a clone. Both repositories go into `repos`.
 */
export async function sharedProject(repos: TempRepo[], files: Record<string, string> = {}): Promise<SharedProject> {
	const repo = await tempRepo();
	repos.push(repo);
	await repo.write('.gitignore', '*.csv\n');
	await repo.write('a.txt', text(LINES));
	await repo.write('b.txt', 'bee\n');
	for (const [file, content] of Object.entries(files)) {
		await repo.write(file, content);
	}
	const a = await repo.commit('A');
	const maya = await repo.clone();
	repos.push(maya);
	await must(maya, ['config', 'user.name', 'Maya']);
	await must(maya, ['config', 'user.email', 'maya@example.com']);
	return { repo, maya, a };
}

/** Maya sets `files` (null removes one), records a checkpoint, and shares it; the project then checks the shared copy. */
export async function mayaShares(repo: TempRepo, maya: TempRepo, files: Record<string, string | null>, title = 'Their change'): Promise<void> {
	for (const [file, content] of Object.entries(files)) {
		if (content === null) {
			await fsp.rm(path.join(maya.root, file), { recursive: true });
		} else {
			await maya.write(file, content);
		}
	}
	await maya.commit(title);
	await repo.pushFrom(maya);
	const checked = await checkShared(repo.ports);
	if (checked.kind !== 'done') {
		throw new Error(`checkShared failed: ${JSON.stringify(checked)}`);
	}
}

/** The branch commit, the index tree, and the working-file tree of the project. */
export async function parts(repo: TempRepo) {
	return {
		branch: await must(repo, ['rev-parse', 'refs/heads/main']),
		index: await must(repo, ['write-tree']),
		worktree: (await worktreeTree(repo.ports)).tree,
	};
}

/**
 * Builds a shared project with one overlap of `kind` (not `unsupported`):
 *
 * - `text`: line 2 of a.txt, Maya's "theirs" against my unrecorded "mine".
 * - `binary`: data.bin, changed by Maya and by a local checkpoint of mine.
 * - `edit-delete`: b.txt, deleted by Maya and edited (unrecorded) by me.
 * - `rename`: a.txt, renamed to theirs.txt by Maya and to mine.txt by a local checkpoint.
 * - `file-folder`: ff, a folder (ff/inside.txt) for Maya and a file I edited in a local checkpoint.
 */
export async function overlapProject(repos: TempRepo[], kind: Exclude<OverlapKind, 'unsupported'>): Promise<SharedProject> {
	switch (kind) {
		case 'text': {
			const project = await sharedProject(repos);
			await mayaShares(project.repo, project.maya, { 'a.txt': withLine(1, 'theirs') });
			await project.repo.write('a.txt', withLine(1, 'mine'));
			return project;
		}
		case 'binary': {
			const project = await sharedProject(repos, { 'data.bin': 'base\0data' });
			await mayaShares(project.repo, project.maya, { 'data.bin': 'theirs\0longer data' });
			await project.repo.write('data.bin', 'mine\0data');
			await project.repo.commit('Mine');
			return project;
		}
		case 'edit-delete': {
			const project = await sharedProject(repos);
			await mayaShares(project.repo, project.maya, { 'b.txt': null });
			await project.repo.write('b.txt', 'mine\n');
			return project;
		}
		case 'rename': {
			const project = await sharedProject(repos);
			await must(project.maya, ['mv', 'a.txt', 'theirs.txt']);
			await mayaShares(project.repo, project.maya, {});
			await must(project.repo, ['mv', 'a.txt', 'mine.txt']);
			await project.repo.commit('Rename mine');
			return project;
		}
		case 'file-folder': {
			const project = await sharedProject(repos, { ff: 'a file\n' });
			await mayaShares(project.repo, project.maya, { 'ff': null, 'ff/inside.txt': 'in a folder\n' });
			await project.repo.write('ff', 'my edit of the file\n');
			await project.repo.commit('Edit ff');
			return project;
		}
	}
}
