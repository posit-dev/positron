/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { readChanges } from './changes';
import {
	acceptCheckedCheckpoint, createCheckpoints, declineCheckedCheckpoint, editDescription, PENDING_REF_PREFIX, readPartialFiles,
	readCheckpoints, readPendingApproval, reverseCheckpoint,
} from './checkpoints';
import { acquireLock, readRecords } from './journal';
import { readOperationLog, redo, undo, undoHead } from './operationLog';
import { runOperation } from './runOperation';
import { getDiff } from './history';
import { must, refExists } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { Chunk, OperationResult } from './types';

// Each test builds candidates, runs hooks, and runs full operations, which exceed the default
// limit under a loaded test run. Hooks are shell scripts, so the suite needs a POSIX shell.
describe.skipIf(process.platform === 'win32')('checkpoints', { timeout: 60_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/** A project with a.txt and b.txt in checkpoint A. */
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.write('b.txt', 'bee\n');
		const a = await repo.commit('A');
		return { repo, a };
	};

	/** Installs an executable shell hook. Hooks run in the project root. */
	const hook = async (repo: TempRepo, name: string, script: string) => {
		const file = path.join(repo.root, '.git', 'hooks', name);
		await fsp.mkdir(path.dirname(file), { recursive: true });
		await fsp.writeFile(file, `#!/bin/sh\n${script}\n`);
		await fsp.chmod(file, 0o755);
	};

	const chunk = (title: string, wholeFiles: string[], hunkIds: string[] = [], body = ''): Chunk => ({ title, body, hunkIds, wholeFiles });

	const head = (repo: TempRepo) => must(repo, ['rev-parse', 'refs/heads/main']);
	const show = (repo: TempRepo, spec: string) => must(repo, ['show', spec]);
	const titles = async (repo: TempRepo) => (await must(repo, ['log', '--format=%s'])).split('\n');

	const readCheckpointsFor = (repo: TempRepo) => readCheckpoints(repo.ports, ['-1', 'HEAD']);

	const createFrom = async (repo: TempRepo, chunks: Chunk[]) => createCheckpoints(repo.ports, (await readChanges(repo.ports)).basis, chunks);

	const doneId = (result: OperationResult): string => {
		if (result.kind !== 'done') {
			throw new Error(`the operation did not finish: ${JSON.stringify(result)}`);
		}
		return result.operationId;
	};

	/** The token of a pending approval result. */
	const tokenOf = (result: OperationResult): string => {
		if (result.kind !== 'check-changed-checkpoint') {
			throw new Error(`expected a pending approval: ${JSON.stringify(result)}`);
		}
		return result.token;
	};

	/** Every file of the project outside `.git`, with its exact bytes. */
	const allBytes = async (repo: TempRepo) => {
		const files: Record<string, string> = {};
		const walk = async (folder: string) => {
			for (const entry of await fsp.readdir(path.join(repo.root, folder), { withFileTypes: true })) {
				const name = folder === '' ? entry.name : `${folder}/${entry.name}`;
				if (name === '.git') {
					continue;
				}
				if (entry.isDirectory()) {
					await walk(name);
				} else {
					files[name] = (await fsp.readFile(path.join(repo.root, name))).toString('base64');
				}
			}
		};
		await walk('');
		return files;
	};

	test('one chunk of whole files becomes one checkpoint', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('c.txt', 'sea\n');

		const result = await createFrom(repo, [chunk('Edit a and add c', ['a.txt', 'c.txt'])]);

		const id = doneId(result);
		expect(await titles(repo)).toEqual(['Edit a and add c', 'A']);
		expect(await must(repo, ['rev-parse', 'HEAD^'])).toBe(a);
		expect([await show(repo, 'HEAD:a.txt'), await show(repo, 'HEAD:c.txt')]).toEqual(['two', 'sea']);
		expect((await readChanges(repo.ports)).files).toEqual([]);
		expect(await must(repo, ['write-tree'])).toBe(await must(repo, ['rev-parse', 'HEAD^{tree}']));
		expect((await undoHead(repo.ports))?.id).toBe(id);
	});

	test('two chunks become two checkpoints in order, one undo entry', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('c.txt', 'sea\n');

		const id = doneId(await createFrom(repo, [chunk('First', ['a.txt']), chunk('Second', ['c.txt'])]));

		expect(await titles(repo)).toEqual(['Second', 'First', 'A']);
		expect(await show(repo, 'HEAD^:a.txt')).toBe('two');
		expect((await repo.git(['cat-file', '-e', 'HEAD^:c.txt'])).exitCode).not.toBe(0);
		expect((await readOperationLog(repo.ports)).map(entry => entry.record.id)).toEqual([id]);

		doneId(await undo(repo.ports, id, []));
		expect(await head(repo)).toBe(a);
		expect([await repo.read('a.txt'), await repo.read('c.txt')]).toEqual(['two\n', 'sea\n']);
	});

	test('a chunk with part of a file records partialFiles and leaves the rest as changes', async () => {
		const { repo } = await create();
		const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
		await repo.write('long.txt', lines.join('\n') + '\n');
		await repo.commit('B');
		await repo.write('long.txt', ['first', ...lines.slice(1, 11), 'last'].join('\n') + '\n');
		const changes = await readChanges(repo.ports);
		const [firstHunk, lastHunk] = changes.files[0].hunks;

		doneId(await createCheckpoints(repo.ports, changes.basis, [chunk('Top line', [], [firstHunk.id])]));

		const commit = await head(repo);
		expect((await show(repo, 'HEAD:long.txt')).split('\n')).toEqual(['first', ...lines.slice(1)]);
		expect((await readPartialFiles(repo.ports)).get(commit)).toEqual(['long.txt']);
		const after = await readChanges(repo.ports);
		expect(after.files.map(file => file.hunks.map(hunk => hunk.id))).toEqual([[lastHunk.id]]);
	});

	test('working files are byte-identical before and after', async () => {
		const { repo } = await create();
		const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
		await repo.write('crlf.txt', words.map(word => `${word}\r\n`).join(''));
		await repo.write('no-newline.txt', words.join('\n'));
		await repo.commit('B');
		const edited = ['ONE', ...words.slice(1, 11), 'TWELVE'];
		await repo.write('crlf.txt', edited.map(word => `${word}\r\n`).join(''));
		await repo.write('no-newline.txt', edited.join('\n'));
		await repo.write('untracked.txt', 'not selected\n');
		await repo.write('a.txt', 'two\n');
		const changes = await readChanges(repo.ports);
		const firstHunks = changes.files.filter(file => file.hunks.length === 2).map(file => file.hunks[0].id);
		expect(firstHunks).toHaveLength(2);
		const before = await allBytes(repo);

		doneId(await createCheckpoints(repo.ports, changes.basis, [chunk('Parts', ['a.txt'], firstHunks)]));

		expect(await allBytes(repo)).toEqual(before);
		const firstOnly = ['ONE', ...words.slice(1)];
		expect((await repo.git(['show', 'HEAD:crlf.txt'])).stdout).toBe(firstOnly.map(word => `${word}\r\n`).join(''));
		expect((await repo.git(['show', 'HEAD:no-newline.txt'])).stdout).toBe(firstOnly.join('\n'));
	});

	test('a stale basis returns changes-moved', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		const { basis } = await readChanges(repo.ports);
		await repo.write('a.txt', 'three\n');

		expect(await createCheckpoints(repo.ports, basis, [chunk('Edit a', ['a.txt'])])).toEqual({ kind: 'changes-moved' });
		expect(await head(repo)).toBe(a);
	});

	test('a request with a bad title, nothing selected, or an unknown hunk changes nothing', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		const { basis } = await readChanges(repo.ports);

		const results = [
			await createCheckpoints(repo.ports, basis, [chunk('', ['a.txt'])]),
			await createCheckpoints(repo.ports, basis, [chunk('x'.repeat(73), ['a.txt'])]),
			await createCheckpoints(repo.ports, basis, [chunk('Two\nlines', ['a.txt'])]),
			await createCheckpoints(repo.ports, basis, []),
			await createCheckpoints(repo.ports, basis, [chunk('Nothing', [])]),
			await createCheckpoints(repo.ports, basis, [chunk('Unknown', [], ['0123456789abcdef'])]),
			await createCheckpoints(repo.ports, basis, [chunk('Unknown file', ['zzz.txt'])]),
		];

		expect(results).toEqual([
			{ kind: 'unavailable', reason: 'nothing-to-do', detail: 'bad-title' },
			{ kind: 'unavailable', reason: 'nothing-to-do', detail: 'bad-title' },
			{ kind: 'unavailable', reason: 'nothing-to-do', detail: 'bad-title' },
			{ kind: 'unavailable', reason: 'nothing-to-do', detail: 'empty' },
			{ kind: 'unavailable', reason: 'nothing-to-do', detail: 'empty' },
			{ kind: 'unavailable', reason: 'nothing-to-do', detail: 'unknown-hunk' },
			{ kind: 'unavailable', reason: 'nothing-to-do', detail: 'unknown-file' },
		]);
		expect(await head(repo)).toBe(a);
		expect(await readOperationLog(repo.ports)).toEqual([]);
	});

	test('title is the first line and body follows a blank line', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');

		doneId(await createFrom(repo, [chunk('Edit a', ['a.txt'], [], 'Why it changed.\nSecond line.')]));

		expect(await must(repo, ['log', '-1', '--format=%B'])).toBe('Edit a\n\nWhy it changed.\nSecond line.');
	});

	test('a hook that stages another file returns check-changed-checkpoint and the branch does not move', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'git add other.txt');

		const result = await createFrom(repo, [chunk('Edit a', ['a.txt'])]);

		expect(result).toMatchObject({ kind: 'check-changed-checkpoint', changedPaths: ['other.txt'], hookEditedFiles: [], chunkIndex: 0 });
		expect(await head(repo)).toBe(a);
		expect(await must(repo, ['write-tree'])).toBe(await must(repo, ['rev-parse', `${a}^{tree}`]));
		expect(await refExists(repo, `${PENDING_REF_PREFIX}${tokenOf(result)}`)).toBe(true);
	});

	test('the pending candidate survives a new engine instance', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'git add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));

		// Only what is on disk is shared with the new instance.
		const fresh = await repo.freshPorts();

		expect(await readPendingApproval(fresh)).toEqual({ token, changedPaths: ['other.txt'], hookEditedFiles: [] });
	});

	test('accept publishes the candidate without running hooks again', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'echo ran >> .git/hook-runs\ngit add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		const candidate = await must(repo, ['rev-parse', `${PENDING_REF_PREFIX}${token}`]);

		const id = doneId(await acceptCheckedCheckpoint(repo.ports, token));

		expect(await fsp.readFile(path.join(repo.root, '.git', 'hook-runs'), 'utf8')).toBe('ran\n');
		expect(await head(repo)).toBe(candidate);
		expect(await must(repo, ['rev-parse', 'HEAD^'])).toBe(a);
		expect(await show(repo, 'HEAD:other.txt')).toBe('not selected');
		expect(await must(repo, ['write-tree'])).toBe(await must(repo, ['rev-parse', 'HEAD^{tree}']));
		expect(await refExists(repo, `${PENDING_REF_PREFIX}${token}`)).toBe(false);
		expect(await readPendingApproval(repo.ports)).toBeUndefined();
		expect((await undoHead(repo.ports))?.id).toBe(id);
	});

	test('accept after a crash names the published operation, not a later Redo of it', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'git add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		const record = (await readRecords(repo.ports)).find(candidate => candidate.id === token)!;
		// Published as accept publishes it, with the pending record left open, as after a crash.
		const published = doneId(await runOperation(repo.ports, {
			kind: 'create-checkpoints', description: record.description, expected: record.before, after: record.after, collisionChoices: [],
		}));
		doneId(await undo(repo.ports, published, []));
		doneId(await redo(repo.ports, published, []));

		expect(await acceptCheckedCheckpoint(repo.ports, token)).toEqual({ kind: 'done', operationId: published, hookEditedFiles: [] });
	});

	test('a hook that replaces a file with a folder is reported and the checkpoint is published', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await hook(repo, 'pre-commit', 'rm b.txt\nmkdir b.txt\necho inner > b.txt/inner.txt');

		const result = await createFrom(repo, [chunk('Edit a', ['a.txt'])]);

		expect(result).toMatchObject({ kind: 'done', hookEditedFiles: ['b.txt', 'b.txt/inner.txt'] });
		expect(await show(repo, 'HEAD:a.txt')).toBe('two');
		expect(await repo.read('b.txt/inner.txt')).toBe('inner\n');
	});

	test('accept after another tool commits returns project-changed', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'git add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		await fsp.rm(path.join(repo.root, '.git', 'hooks', 'pre-commit'));
		const other = await repo.commit('Another tool');

		expect(await acceptCheckedCheckpoint(repo.ports, token)).toEqual({ kind: 'project-changed' });
		expect(await head(repo)).toBe(other);
		expect(await refExists(repo, `${PENDING_REF_PREFIX}${token}`)).toBe(false);
		expect(await readPendingApproval(repo.ports)).toBeUndefined();
	});

	test('decline removes the pending ref', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'git add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));

		expect(await declineCheckedCheckpoint(repo.ports, token)).toMatchObject({ kind: 'done', hookEditedFiles: [] });
		expect(await head(repo)).toBe(a);
		expect(await refExists(repo, `${PENDING_REF_PREFIX}${token}`)).toBe(false);
		expect(await readPendingApproval(repo.ports)).toBeUndefined();
		expect(await acceptCheckedCheckpoint(repo.ports, token)).toEqual({ kind: 'unavailable', reason: 'stale-operation-id' });
	});

	test('a new request cancels a pending approval', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'git add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		await fsp.rm(path.join(repo.root, '.git', 'hooks', 'pre-commit'));

		doneId(await createFrom(repo, [chunk('Edit a again', ['a.txt'])]));

		expect(await refExists(repo, `${PENDING_REF_PREFIX}${token}`)).toBe(false);
		expect(await readPendingApproval(repo.ports)).toBeUndefined();
		expect(await titles(repo)).toEqual(['Edit a again', 'A']);
	});

	test('a hook that changes the second chunk publishes the first and holds the second for approval', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('c.txt', 'sea\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'if [ -f .git/ran-once ]; then git add other.txt; fi\ntouch .git/ran-once');

		const result = await createFrom(repo, [chunk('First', ['a.txt']), chunk('Second', ['c.txt'])]);

		expect(result).toMatchObject({ kind: 'check-changed-checkpoint', changedPaths: ['other.txt'], chunkIndex: 1 });
		expect(await titles(repo)).toEqual(['First', 'A']);
		expect(await must(repo, ['rev-parse', 'HEAD^'])).toBe(a);
		const candidate = await must(repo, ['rev-parse', `${PENDING_REF_PREFIX}${tokenOf(result)}`]);
		expect(await must(repo, ['rev-parse', `${candidate}^`])).toBe(await head(repo));

		doneId(await acceptCheckedCheckpoint(repo.ports, tokenOf(result)));
		expect(await titles(repo)).toEqual(['Second', 'First', 'A']);
	});

	test('a rejecting formatter hook leaves a check-changed-files undo entry that restores the files', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await hook(repo, 'pre-commit', 'printf "formatted\\n" > b.txt\necho "style check failed"\nexit 1');

		const result = await createFrom(repo, [chunk('Edit a', ['a.txt'])]);

		expect(result).toMatchObject({ kind: 'check-failed', hookEditedFiles: ['b.txt'], chunkIndex: 0 });
		expect(result.kind === 'check-failed' && result.output).toContain('style check failed');
		expect(await head(repo)).toBe(a);
		expect(await repo.read('b.txt')).toBe('formatted\n');
		const operationId = result.kind === 'check-failed' ? result.operationId : undefined;
		expect((await undoHead(repo.ports))?.kind).toBe('check-changed-files');

		doneId(await undo(repo.ports, operationId!, []));
		expect([await repo.read('a.txt'), await repo.read('b.txt')]).toEqual(['two\n', 'bee\n']);
		expect(await head(repo)).toBe(a);
	});

	test('undo of a checkpoint returns formatter edits to prior content', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await hook(repo, 'pre-commit', 'printf "formatted\\n" > b.txt');

		const result = await createFrom(repo, [chunk('Edit a', ['a.txt'])]);

		expect(result).toMatchObject({ kind: 'done', hookEditedFiles: ['b.txt'] });
		expect(await repo.read('b.txt')).toBe('formatted\n');
		doneId(await undo(repo.ports, doneId(result), []));
		expect(await head(repo)).toBe(a);
		expect([await repo.read('a.txt'), await repo.read('b.txt')]).toEqual(['two\n', 'bee\n']);
	});

	test('editDescription rewords an unshared checkpoint and keeps later ones', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('c.txt', 'sea\n');
		doneId(await createFrom(repo, [chunk('First', ['a.txt']), chunk('Second', ['c.txt'])]));
		const first = await must(repo, ['rev-parse', 'HEAD^']);
		const format = '%T%x00%an%x00%ae%x00%ad';
		const before = (await must(repo, ['log', `--format=${format}`, '-2', '--date=raw'])).split('\n');
		repo.clock.advance(60_000);

		const id = doneId(await editDescription(repo.ports, first, 'First, reworded', 'Because.'));

		expect(await titles(repo)).toEqual(['Second', 'First, reworded', 'A']);
		expect(await must(repo, ['log', '-1', '--format=%B', 'HEAD^'])).toBe('First, reworded\n\nBecause.');
		expect((await must(repo, ['log', `--format=${format}`, '-2', '--date=raw'])).split('\n')).toEqual(before);
		expect(await must(repo, ['rev-parse', 'HEAD~2'])).toBe(a);
		expect(await must(repo, ['rev-parse', 'HEAD^'])).not.toBe(first);
		expect([await repo.read('a.txt'), await repo.read('c.txt')]).toEqual(['two\n', 'sea\n']);
		expect((await undoHead(repo.ports))?.id).toBe(id);
	});

	test('editDescription of a shared checkpoint is refused', async () => {
		const { repo, a } = await create();
		await repo.clone();

		expect(await editDescription(repo.ports, a, 'New title', '')).toEqual({ kind: 'unavailable', reason: 'shared-checkpoint' });
		expect(await head(repo)).toBe(a);
	});

	test('editDescription of a checkpoint outside the current history is refused', async () => {
		const { repo, a } = await create();
		const elsewhere = await must(repo, ['commit-tree', `${a}^{tree}`, '-p', a, '-m', 'Elsewhere']);

		expect(await editDescription(repo.ports, elsewhere, 'New title', '')).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'not-in-history' });
		expect(await head(repo)).toBe(a);
	});

	test('reverseCheckpoint creates a checkpoint with the opposite change', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		doneId(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		const edit = await head(repo);
		await repo.write('b.txt', 'bee two\n');
		doneId(await createFrom(repo, [chunk('Edit b', ['b.txt'])]));
		await repo.write('u.txt', 'untracked\n');

		const id = doneId(await reverseCheckpoint(repo.ports, edit));

		expect(await titles(repo)).toEqual(['Reversed: Edit a', 'Edit b', 'Edit a', 'A']);
		expect([await show(repo, 'HEAD:a.txt'), await show(repo, 'HEAD:b.txt')]).toEqual(['one', 'bee two']);
		expect([await repo.read('a.txt'), await repo.read('b.txt'), await repo.read('u.txt')]).toEqual(['one\n', 'bee two\n', 'untracked\n']);
		expect((await readChanges(repo.ports)).files.map(file => file.path)).toEqual(['u.txt']);

		doneId(await undo(repo.ports, id, []));
		expect(await repo.read('a.txt')).toBe('two\n');
		expect(await titles(repo)).toEqual(['Edit b', 'Edit a', 'A']);
	});

	test('reverseCheckpoint over an unrecorded edit of the same lines returns overlaps and changes nothing', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		doneId(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		const edit = await head(repo);
		await repo.write('a.txt', 'three\n');

		const result = await reverseCheckpoint(repo.ports, edit);

		expect(result).toMatchObject({ kind: 'overlaps', preview: { incoming: [], overlaps: [{ kind: 'text', path: 'a.txt' }] } });
		expect(await head(repo)).toBe(edit);
		expect(await repo.read('a.txt')).toBe('three\n');
	});

	test('a publish that fails after a formatter hook ran records the edits for Undo', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'staged elsewhere\n');
		// The hook stages a file in the real index, so the index the request read has moved.
		await hook(repo, 'pre-commit', 'printf "formatted\\n" > b.txt\nGIT_INDEX_FILE=.git/index git add other.txt');

		const result = await createFrom(repo, [chunk('Edit a', ['a.txt'])]);

		expect(result).toEqual({ kind: 'changes-moved' });
		expect(await head(repo)).toBe(a);
		expect(await repo.read('b.txt')).toBe('formatted\n');
		const entry = await undoHead(repo.ports);
		expect(entry?.kind).toBe('check-changed-files');
		doneId(await undo(repo.ports, entry!.id, []));
		expect(await repo.read('b.txt')).toBe('bee\n');
	});

	test('a failed publish of the chunks before a rejected one records the hook edits for Undo', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('c.txt', 'sea\n');
		await repo.write('other.txt', 'staged elsewhere\n');
		await hook(repo, 'pre-commit', [
			'printf "formatted\\n" > b.txt',
			'if [ -f .git/ran-once ]; then echo "second check failed"; exit 1; fi',
			'touch .git/ran-once',
			'GIT_INDEX_FILE=.git/index git add other.txt',
		].join('\n'));

		const result = await createFrom(repo, [chunk('First', ['a.txt']), chunk('Second', ['c.txt'])]);

		expect(result).toEqual({ kind: 'changes-moved' });
		expect(await head(repo)).toBe(a);
		const entry = await undoHead(repo.ports);
		expect(entry?.kind).toBe('check-changed-files');
		doneId(await undo(repo.ports, entry!.id, []));
		expect(await repo.read('b.txt')).toBe('bee\n');
	});

	test('a stale accept records the hook edits for Undo', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'printf "formatted\\n" > b.txt\ngit add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		await fsp.rm(path.join(repo.root, '.git', 'hooks', 'pre-commit'));
		await repo.write('c.txt', 'another tool\n');
		await must(repo, ['add', 'c.txt']);
		await must(repo, ['commit', '-q', '-m', 'Another tool']);

		expect(await acceptCheckedCheckpoint(repo.ports, token)).toEqual({ kind: 'project-changed' });
		const entry = await undoHead(repo.ports);
		expect(entry?.kind).toBe('check-changed-files');
		doneId(await undo(repo.ports, entry!.id, []));
		expect(await repo.read('b.txt')).toBe('bee\n');
	});

	test('a stale accept while another window holds the lock reports busy and keeps the approval', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		await hook(repo, 'pre-commit', 'printf "formatted\\n" > b.txt\ngit add other.txt');
		const token = tokenOf(await createFrom(repo, [chunk('Edit a', ['a.txt'])]));
		await fsp.rm(path.join(repo.root, '.git', 'hooks', 'pre-commit'));
		await repo.write('c.txt', 'another tool\n');
		await must(repo, ['add', 'c.txt']);
		await must(repo, ['commit', '-q', '-m', 'Another tool']);
		const lock = await acquireLock(repo.ports);

		try {
			expect(await acceptCheckedCheckpoint(repo.ports, token)).toEqual({ kind: 'unavailable', reason: 'busy' });
			expect((await readPendingApproval(repo.ports))?.token).toBe(token);
		} finally {
			await lock!.release();
		}
	});

	test('object ids from a caller must be full length', async () => {
		const { repo, a } = await create();
		await repo.write('a.txt', 'two\n');
		const b = await repo.commit('B');
		// A branch whose name is a hex string resolves before any object id prefix.
		await must(repo, ['branch', 'deadbeef', a]);

		const notInHistory = { kind: 'unavailable', reason: 'nothing-to-do', detail: 'not-in-history' };
		expect(await editDescription(repo.ports, b.slice(0, 12), 'Short', '')).toEqual(notInHistory);
		expect(await editDescription(repo.ports, 'deadbeef', 'Branch', '')).toEqual(notInHistory);
		expect(await reverseCheckpoint(repo.ports, b.slice(0, 12))).toEqual(notInHistory);
		const empty = { left: { kind: 'empty' }, right: { kind: 'empty' } };
		expect(await getDiff(repo.ports, { kind: 'checkpoint', id: b.slice(0, 12), path: 'a.txt' })).toEqual(empty);
		expect(await getDiff(repo.ports, { kind: 'trees', left: a.slice(0, 12), right: 'deadbeef', path: 'a.txt' })).toEqual(empty);
		expect(await head(repo)).toBe(b);
	});

	test('rewording a commit in another encoding writes UTF-8 and keeps the author name', async () => {
		const { repo, a } = await create();
		const tree = await must(repo, ['rev-parse', `${a}^{tree}`]);
		const latin1 = Buffer.concat([
			Buffer.from(`tree ${tree}\nparent ${a}\n`),
			Buffer.from('author Jos\xe9 <jose@example.com> 1767225600 +0100\n', 'latin1'),
			Buffer.from('committer Test User <test@example.com> 1767225600 +0100\nencoding ISO-8859-1\n\n'),
			Buffer.from('R\xe9sum\xe9\n', 'latin1'),
		]);
		const commit = await must(repo, ['hash-object', '-t', 'commit', '-w', '--stdin'], { stdin: latin1 });
		await must(repo, ['update-ref', 'refs/heads/main', commit]);

		doneId(await editDescription(repo.ports, commit, 'R\u00e9sum\u00e9, reworded', ''));

		const raw = Buffer.from((await repo.git(['cat-file', 'commit', 'HEAD'], { binary: true })).stdout, 'latin1');
		expect(raw.toString('utf8')).toMatch(/^author Jos\u00e9 <jose@example\.com> 1767225600 \+0100$/m);
		expect(raw.toString('utf8')).not.toMatch(/^encoding /m);
		expect(raw.toString('utf8').endsWith('\n\nR\u00e9sum\u00e9, reworded\n')).toBe(true);
	});

	test('a message with any characters is read back whole', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.commit('Title\n\nBody\x1fwith a unit separator\x1eand a record separator.');

		const [checkpoint] = await readCheckpointsFor(repo);

		expect([checkpoint.title, checkpoint.body]).toEqual(['Title', 'Body\x1fwith a unit separator\x1eand a record separator.']);
		expect(checkpoint.authorName).toBe('Test User');
	});

	// Review Focus 3.
	test('the first checkpoint in a repository with no checkpoints', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');

		doneId(await createFrom(repo, [chunk('Start', ['a.txt'])]));

		expect(await titles(repo)).toEqual(['Start']);
		expect((await repo.git(['rev-parse', '--verify', '-q', 'HEAD^'])).exitCode).not.toBe(0);
		expect(await show(repo, 'HEAD:a.txt')).toBe('one');
		expect((await readChanges(repo.ports)).files).toEqual([]);
	});
});
