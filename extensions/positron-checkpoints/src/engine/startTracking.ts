/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readChanges } from './changes';
import { createCheckpoints } from './checkpoints';
import { mustGit, runGit, splitZ } from './git';
import { readBranch, readIndexTree } from './journal';
import { noteNewOperation } from './operationLog';
import { EnginePorts } from './ports';
import { isIdentityMissingIn } from './repoState';
import { runOperation } from './runOperation';
import { LARGE_FILE_BYTES, STAGING_TIMEOUT_MS, worktreeTree } from './trees';
import { OperationResult } from './types';

/** The title of the first checkpoint of a project. */
export const FIRST_CHECKPOINT_TITLE = 'Started keeping checkpoints';

/** The patterns every proposed `.gitignore` has: files that data science tools create and that belong in no checkpoint. */
const PROPOSED_PATTERNS = [
	'.Rproj.user/', '.Rhistory', '.RData', '.Ruserdata',
	'__pycache__/', '*.pyc', '.venv/', 'venv/', '.ipynb_checkpoints/',
	'.DS_Store', 'Thumbs.db', '.env',
	'renv/library/', '.quarto/', '/.positron/',
];

/**
 * The `.gitignore` proposed for a plain folder (spec 6.6): `PROPOSED_PATTERNS`, then one line per
 * file over the large file limit (50 MB), as its path from the opened folder with a leading `/`
 * (so it matches only that file) and the characters `.gitignore` treats as patterns escaped.
 * Files that the patterns or an existing `.gitignore` already leave out are not listed. Nothing
 * in the folder changes: git lists the files with a temporary git directory outside it.
 */
export async function proposedGitignore(ports: EnginePorts): Promise<string> {
	const lines = [...PROPOSED_PATTERNS];
	for (const file of await untrackedFiles(ports)) {
		const info = await ports.files.lstat(file);
		if (info !== undefined && !info.isDirectory && !info.isSymbolicLink && info.sizeBytes > LARGE_FILE_BYTES) {
			lines.push(`/${escapePattern(file)}`);
		}
	}
	return lines.join('\n') + '\n';
}

/** The files in the opened folder that neither `PROPOSED_PATTERNS` nor the folder's own ignore files leave out. */
async function untrackedFiles(ports: EnginePorts): Promise<string[]> {
	const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-checkpoints-propose-'));
	try {
		const gitDir = path.join(temporary, 'git');
		const patterns = path.join(temporary, 'patterns');
		await mustGit(ports.git, ['init', '-q', '--bare', gitDir]);
		await fsp.writeFile(patterns, PROPOSED_PATTERNS.join('\n') + '\n');
		const listed = await mustGit(ports.git, [
			'-C', ports.openedFolder, `--git-dir=${gitDir}`, `--work-tree=${ports.openedFolder}`,
			'ls-files', '-z', '--others', '--exclude-standard', `--exclude-from=${patterns}`,
		], { timeoutMs: STAGING_TIMEOUT_MS });
		return splitZ(listed.stdout);
	} finally {
		await fsp.rm(temporary, { recursive: true, force: true });
	}
}

/** Escapes the characters `.gitignore` reads as patterns, and trailing spaces, so a line names exactly one path. */
function escapePattern(file: string): string {
	return file.replace(/[\\*?[!#]/g, character => `\\${character}`).replace(/ +$/, spaces => spaces.replace(/ /g, '\\ '));
}

/**
 * Starts keeping checkpoints in the opened folder, which is not a repository (spec 6.6, starting
 * point B):
 *
 * 1. Without `identity`, git must have an explicit name and email (see `isIdentityMissing`);
 *    otherwise nothing changes and the result is `unavailable nothing-to-do identity-missing`.
 *    An identity with an empty part, a line break, or an angle bracket counts as none.
 * 2. `git init -b main`, then `user.name` and `user.email` in the repository's own configuration
 *    when `identity` is given, then `.gitignore` with `gitignore` when it is given and no
 *    `.gitignore` exists (an existing one is never replaced).
 * 3. The first checkpoint, titled `FIRST_CHECKPOINT_TITLE`, with every changed file that is not
 *    too large, through `createCheckpoints`, so the project's hooks, the journal, and the
 *    operation protocol apply. A folder with no files gets no checkpoint.
 * 4. A `start-tracking` operation is recorded, which clears the undo and redo lists, so starting
 *    is not undoable (spec 6.3).
 *
 * Steps 1 and 2 run before the engine's own files exist, so they do not use the journal or the
 * lock. When the first checkpoint does not finish, the repository stays initialized (a project
 * with no checkpoints) and that result is returned. Returns `unavailable nothing-to-do
 * already-tracking` when the folder is inside a repository, and otherwise `done` with the id of
 * the `start-tracking` operation and the files the project's hooks changed.
 */
export async function startTracking(ports: EnginePorts, identity?: { name: string; email: string }, gitignore?: string): Promise<OperationResult> {
	const folder = ports.openedFolder;
	const project: EnginePorts = { ...ports, projectRoot: folder };
	if ((await runGit(ports.git, ['-C', folder, 'rev-parse', '--show-toplevel'])).exitCode === 0) {
		return { kind: 'unavailable', reason: 'nothing-to-do', detail: 'already-tracking' };
	}
	if (identity !== undefined && !isUsableIdentity(identity)) {
		return { kind: 'unavailable', reason: 'nothing-to-do', detail: 'identity-missing' };
	}
	if (identity === undefined && await isIdentityMissingIn(ports, folder)) {
		return { kind: 'unavailable', reason: 'nothing-to-do', detail: 'identity-missing' };
	}

	await mustGit(ports.git, ['-C', folder, 'init', '-q', '-b', 'main']);
	if (identity !== undefined) {
		await mustGit(ports.git, ['-C', folder, 'config', '--local', 'user.name', identity.name.trim()]);
		await mustGit(ports.git, ['-C', folder, 'config', '--local', 'user.email', identity.email.trim()]);
	}
	if (gitignore !== undefined && await ports.files.lstat('.gitignore') === undefined) {
		// Created only when nothing is at the path, even one made since the check.
		await ports.files.createExclusive('.gitignore', gitignore);
	}

	const changes = await readChanges(project);
	const files = changes.files.filter(file => !file.tooLarge).map(file => file.path);
	let hookEditedFiles: string[] = [];
	if (files.length > 0) {
		const created = await createCheckpoints(project, changes.basis, [{ title: FIRST_CHECKPOINT_TITLE, body: '', hunkIds: [], wholeFiles: files }]);
		if (created.kind !== 'done') {
			return created;
		}
		hookEditedFiles = created.hookEditedFiles;
	}

	const indexTree = await readIndexTree(project);
	if (indexTree === undefined) {
		return { kind: 'could-not-finish', detail: 'The index of the new project could not be read.' };
	}
	const state = { branchCommit: await readBranch(project, 'main'), indexTree, worktreeTree: (await worktreeTree(project)).tree };
	const recorded = await runOperation(project, { kind: 'start-tracking', description: 'Start keeping checkpoints', expected: state, after: state, collisionChoices: [] });
	if (recorded.kind !== 'done') {
		return recorded;
	}
	await noteNewOperation(project, 'start-tracking');
	return { kind: 'done', operationId: recorded.operationId, hookEditedFiles };
}

/** True when both parts are set and git can store them as they are. */
function isUsableIdentity(identity: { name: string; email: string }): boolean {
	return [identity.name, identity.email].every(part => part.trim() !== '' && !/[\r\n<>]/.test(part));
}
