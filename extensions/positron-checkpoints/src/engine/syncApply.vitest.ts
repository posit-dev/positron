/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { readChanges } from './changes';
import { createCheckpoints, readPartialFiles } from './checkpoints';
import { acquireLock, engineDirectory, readRecords } from './journal';
import { expire, readOperationLog, redoHead, undo, undoHead } from './operationLog';
import { GitRunner } from './ports';
import { getIncoming, previewIncoming, sendChanges } from './sync';
import { faultPorts } from './test/faultPorts';
import { must, refExists } from './test/operationFixtures';
import { LINES, mayaShares, overlapProject, parts, sharedProject, text, withLine } from './test/syncFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { SNAPSHOT_REF_PREFIX } from './trees';
import { OperationResult, OverlapChoice, OverlapKind, Resolution } from './types';

const doneId = (result: OperationResult): string => {
	if (result.kind !== 'done') {
		throw new Error(`the operation did not finish: ${JSON.stringify(result)}`);
	}
	return result.operationId;
};

/** Every file of the project outside `.git`, with its content. */
async function files(repo: TempRepo): Promise<Record<string, string>> {
	const found: Record<string, string> = {};
	const walk = async (folder: string) => {
		for (const entry of await fsp.readdir(path.join(repo.root, folder), { withFileTypes: true })) {
			const name = folder === '' ? entry.name : `${folder}/${entry.name}`;
			if (name === '.git') {
				continue;
			}
			if (entry.isDirectory()) {
				await walk(name);
			} else {
				found[name] = await fsp.readFile(path.join(repo.root, name), 'latin1');
			}
		}
	};
	await walk('');
	return found;
}

/** The three parts of the project and every file. */
const everything = async (repo: TempRepo) => ({ ...await parts(repo), files: await files(repo) });

/**
 * A shared project where Maya changed line 1 of a.txt, removed b.txt, and added c.txt, while I
 * have an unrecorded edit of line 10 of a.txt and an untracked u.txt. With `localCheckpoints`, I
 * also have two checkpoints she does not have, which add d.txt and e.txt. Getting her changes is clean.
 */
async function cleanIncoming(repos: TempRepo[], options: { localCheckpoints?: boolean } = {}) {
	const project = await sharedProject(repos);
	await mayaShares(project.repo, project.maya, { 'a.txt': withLine(0, 'theirs'), 'b.txt': null, 'c.txt': 'new\n' });
	if (options.localCheckpoints) {
		await project.repo.write('d.txt', 'dee\n');
		await project.repo.commit('Local 1');
		await project.repo.write('e.txt', 'ee\n');
		await project.repo.commit('Local 2');
	}
	await project.repo.write('a.txt', withLine(9, 'mine'));
	await project.repo.write('u.txt', 'untracked\n');
	return project;
}

/** Each allowed choice of each kind, with what the project has after getting the changes with it. */
const allowedChoices: [Exclude<OverlapKind, 'unsupported'>, OverlapChoice['type'], OverlapChoice, Record<string, string | null>][] = [
	['text', 'text', { type: 'text', content: 'combined\n' }, { 'a.txt': 'combined\n' }],
	['text', 'take', { type: 'take', side: 'theirs' }, { 'a.txt': withLine(1, 'theirs') }],
	['binary', 'take', { type: 'take', side: 'mine' }, { 'data.bin': 'mine\0data' }],
	['binary', 'keep-both', { type: 'keep-both', renamedSide: 'mine', newPath: 'data-mine.bin' }, { 'data.bin': 'theirs\0longer data', 'data-mine.bin': 'mine\0data' }],
	['edit-delete', 'keep-file', { type: 'keep-file' }, { 'b.txt': 'mine\n' }],
	['edit-delete', 'accept-deletion', { type: 'accept-deletion' }, { 'b.txt': null }],
	['rename', 'path', { type: 'path', keepPath: 'mine.txt' }, { 'mine.txt': text(LINES), 'theirs.txt': null, 'a.txt': null }],
	['file-folder', 'keep-both', { type: 'keep-both', renamedSide: 'mine', newPath: 'ff-mine' }, { 'ff/inside.txt': 'in a folder\n', 'ff-mine': 'my edit of the file\n' }],
	['file-folder', 'take', { type: 'take', side: 'theirs' }, { 'ff/inside.txt': 'in a folder\n', 'ff-mine': null }],
];

// Each test runs several repositories and full operations, which exceed the default limit under a loaded test run.
describe('getting and sending changes', { timeout: 60_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/** The preview, and a resolution of its one overlap with `choice`. */
	const resolve = async (repo: TempRepo, choice: OverlapChoice) => {
		const preview = await previewIncoming(repo.ports);
		expect(preview.overlaps).toHaveLength(1);
		const resolution: Resolution = { overlapId: preview.overlaps[0].id, choice };
		return { preview, resolution };
	};

	test('clean incoming: files updated, unrecorded edit kept unstaged, one undo entry', async () => {
		const { repo } = await cleanIncoming(repos);
		const { basis } = await previewIncoming(repo.ports);

		const id = doneId(await getIncoming(repo.ports, basis, [], []));

		expect(await repo.read('a.txt')).toBe(text(['theirs', ...LINES.slice(1, 9), 'mine']));
		expect(await repo.read('c.txt')).toBe('new\n');
		await expect(fsp.stat(path.join(repo.root, 'b.txt'))).rejects.toThrow();
		expect(await repo.read('u.txt')).toBe('untracked\n');
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(await must(repo, ['rev-parse', 'refs/remotes/origin/main']));
		expect(await must(repo, ['diff', '--cached', '--name-only'])).toBe('');
		expect(await must(repo, ['diff', '--name-only'])).toBe('a.txt');
		expect((await readOperationLog(repo.ports)).map(entry => [entry.record.kind, entry.record.description])).toEqual([['get-changes', 'Get changes from Maya']]);
		expect((await undoHead(repo.ports))?.id).toBe(id);
	});

	test('undo after get-changes restores the exact prior state', async () => {
		const { repo } = await cleanIncoming(repos);
		const before = await everything(repo);
		const id = doneId(await getIncoming(repo.ports, (await previewIncoming(repo.ports)).basis, [], []));

		doneId(await undo(repo.ports, id, []));

		expect(await everything(repo)).toEqual(before);
		expect((await redoHead(repo.ports))?.id).toBe(id);
	});

	test('overlap with no resolution returns overlaps and changes nothing', async () => {
		const { repo } = await overlapProject(repos, 'text');
		const before = await everything(repo);
		const preview = await previewIncoming(repo.ports);

		const result = await getIncoming(repo.ports, preview.basis, [], []);

		expect(result).toEqual({ kind: 'overlaps', preview: { ...preview, collisions: [] } });
		expect(await everything(repo)).toEqual(before);
		expect(await readRecords(repo.ports)).toEqual([]);
	});

	test('text resolution with replacement content is applied', async () => {
		const { repo } = await overlapProject(repos, 'text');
		const { preview, resolution } = await resolve(repo, { type: 'text', content: 'line 1\nboth of us\n' });

		doneId(await getIncoming(repo.ports, preview.basis, [resolution], []));

		expect(await repo.read('a.txt')).toBe('line 1\nboth of us\n');
		expect(await must(repo, ['show', 'HEAD:a.txt'])).toBe(withLine(1, 'theirs').trimEnd());
	});

	test.each(allowedChoices)('%s overlap with %s', async (kind, _type, choice, expected) => {
		const { repo } = await overlapProject(repos, kind);
		const { preview, resolution } = await resolve(repo, choice);
		expect(preview.overlaps[0].kind).toBe(kind);

		doneId(await getIncoming(repo.ports, preview.basis, [resolution], []));

		const actual: Record<string, string | null> = {};
		for (const file of Object.keys(expected)) {
			actual[file] = await fsp.readFile(path.join(repo.root, file), 'latin1').catch(() => null);
		}
		expect(actual).toEqual(expected);
		expect(await must(repo, ['rev-list', '--merges', 'HEAD'])).toBe('');
		expect((await repo.git(['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'])).exitCode).toBe(0);
	});

	test('a choice not allowed for the kind is refused and nothing changes', async () => {
		const { repo } = await overlapProject(repos, 'text');
		const before = await everything(repo);
		const { preview, resolution } = await resolve(repo, { type: 'keep-file' });

		const result = await getIncoming(repo.ports, preview.basis, [resolution], []);

		expect(result).toEqual({ kind: 'inputs-changed', changed: [], preview });
		expect(await everything(repo)).toEqual(before);
	});

	test('a new name that is already used, or unsafe, is refused', async () => {
		const { repo } = await overlapProject(repos, 'binary');
		const before = await everything(repo);
		for (const newPath of ['b.txt', '../outside.bin', '.git/data.bin', 'a.txt/inside.bin', '']) {
			const { preview, resolution } = await resolve(repo, { type: 'keep-both', renamedSide: 'mine', newPath });
			expect(await getIncoming(repo.ports, preview.basis, [resolution], [])).toMatchObject({ kind: 'inputs-changed', changed: [] });
		}
		expect(await everything(repo)).toEqual(before);
	});

	test('a resolution is rejected after I edit the overlapping file', async () => {
		const { repo } = await overlapProject(repos, 'text');
		const { preview, resolution } = await resolve(repo, { type: 'take', side: 'theirs' });
		await repo.write('a.txt', withLine(1, 'mine, edited after the review'));

		const result = await getIncoming(repo.ports, preview.basis, [resolution], []);

		expect(result).toMatchObject({ kind: 'inputs-changed', changed: ['files'] });
		expect(await repo.read('a.txt')).toBe(withLine(1, 'mine, edited after the review'));
	});

	test('a resolution is rejected after the upstream moves', async () => {
		const { repo, maya } = await overlapProject(repos, 'text');
		const { preview, resolution } = await resolve(repo, { type: 'take', side: 'theirs' });
		await mayaShares(repo, maya, { 'b.txt': 'more\n' }, 'More');
		const before = await everything(repo);

		const result = await getIncoming(repo.ports, preview.basis, [resolution], []);

		expect(result).toMatchObject({ kind: 'inputs-changed', changed: ['shared'] });
		if (result.kind === 'inputs-changed') {
			expect(result.preview.incoming.map(checkpoint => checkpoint.title)).toEqual(['More', 'Their change']);
		}
		expect(await everything(repo)).toEqual(before);
	});

	test('a resolution is rejected after a new local checkpoint', async () => {
		const { repo } = await overlapProject(repos, 'text');
		const { preview, resolution } = await resolve(repo, { type: 'take', side: 'theirs' });
		await repo.write('c.txt', 'new\n');
		await must(repo, ['add', 'c.txt']);
		await must(repo, ['commit', '-m', 'Mine']);
		const before = await everything(repo);

		const result = await getIncoming(repo.ports, preview.basis, [resolution], []);

		expect(result).toMatchObject({ kind: 'inputs-changed', changed: ['mine'] });
		expect(await everything(repo)).toEqual(before);
	});

	test('a preview whose upstream moves while it is built has the basis of the upstream it lists', async () => {
		const { repo, maya } = await cleanIncoming(repos);
		const listed = await must(repo, ['rev-parse', 'refs/remotes/origin/main']);
		// Maya shares more, but the project has not checked yet.
		await maya.write('b.txt', 'more\n');
		await maya.commit('More');
		await repo.pushFrom(maya);
		let moved = false;
		const movingGit: GitRunner = async (args, options) => {
			if (!moved && args.includes('merge-tree')) {
				// The upstream moves after the preview read it and before it computes the basis.
				moved = true;
				await must(repo, ['fetch', '-q', 'origin']);
			}
			return repo.ports.git(args, options);
		};

		const preview = await previewIncoming({ ...repo.ports, git: movingGit });

		expect(moved).toBe(true);
		expect(await must(repo, ['rev-parse', 'refs/remotes/origin/main'])).not.toBe(listed);
		expect(preview.incoming.map(checkpoint => checkpoint.title)).toEqual(['Their change']);
		const before = await everything(repo);
		const result = await getIncoming(repo.ports, preview.basis, [], []);
		expect(result).toMatchObject({ kind: 'inputs-changed', changed: ['shared'] });
		expect(await everything(repo)).toEqual(before);
	});

	test('an edit to an unrelated file does not reject the resolution and is kept', async () => {
		const { repo } = await overlapProject(repos, 'text');
		const { preview, resolution } = await resolve(repo, { type: 'take', side: 'mine' });
		await repo.write('b.txt', 'edited after the review\n');

		doneId(await getIncoming(repo.ports, preview.basis, [resolution], []));

		expect(await repo.read('a.txt')).toBe(withLine(1, 'mine'));
		expect(await repo.read('b.txt')).toBe('edited after the review\n');
	});

	test('an edit since the review that makes a new overlap returns it and changes nothing', async () => {
		const { repo, maya } = await sharedProject(repos);
		await mayaShares(repo, maya, { 'a.txt': withLine(1, 'theirs'), 'b.txt': 'theirs\n' });
		await repo.write('a.txt', withLine(1, 'mine'));
		const { preview, resolution } = await resolve(repo, { type: 'take', side: 'mine' });
		await repo.write('b.txt', 'mine\n');
		const before = await everything(repo);

		const result = await getIncoming(repo.ports, preview.basis, [resolution], []);

		expect(result.kind).toBe('overlaps');
		if (result.kind === 'overlaps') {
			// The new basis also binds the new overlap's file.
			expect(result.preview.basis).not.toBe(preview.basis);
			expect(result.preview.overlaps.map(overlap => [overlap.path, overlap.id === resolution.overlapId])).toEqual([['a.txt', true], ['b.txt', false]]);
		}
		expect(await everything(repo)).toEqual(before);
	});

	test('work staged by another tool is refused and nothing changes', async () => {
		const { repo } = await cleanIncoming(repos);
		await must(repo, ['add', 'u.txt']);
		const before = await everything(repo);

		const result = await getIncoming(repo.ports, (await previewIncoming(repo.ports)).basis, [], []);

		expect(result).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'staged-work' });
		expect(await everything(repo)).toEqual(before);
	});

	test('git without --merge-base returns git-too-old and changes nothing', async () => {
		const { repo } = await cleanIncoming(repos);
		const before = await everything(repo);
		const { basis } = await previewIncoming(repo.ports);
		const oldGit: GitRunner = async (args, options) => args.includes('merge-tree') && args.includes('-h')
			? { stdout: '', stderr: 'usage: git merge-tree [--write-tree] [<options>] <branch1> <branch2>\n', exitCode: 129, timedOut: false }
			: repo.ports.git(args, options);

		expect(await getIncoming({ ...repo.ports, git: oldGit }, basis, [], [])).toEqual({ kind: 'unavailable', reason: 'git-too-old' });

		expect(await everything(repo)).toEqual(before);
	});

	test('sendChanges updates the shared copy and clears undo and redo', async () => {
		const { repo } = await sharedProject(repos);
		const checkpoint = async (file: string) => {
			await repo.write(file, 'mine\n');
			return doneId(await createCheckpoints(repo.ports, (await readChanges(repo.ports)).basis, [{ title: `Add ${file}`, body: '', hunkIds: [], wholeFiles: [file] }]));
		};
		await checkpoint('c.txt');
		const local = await must(repo, ['rev-parse', 'HEAD']);
		doneId(await undo(repo.ports, await checkpoint('d.txt'), []));
		expect([(await undoHead(repo.ports)) !== undefined, (await redoHead(repo.ports)) !== undefined]).toEqual([true, true]);

		const result = await sendChanges(repo.ports);

		expect(result).toMatchObject({ kind: 'done', operationId: expect.stringMatching(/^op-/) });
		expect(await must(repo, ['rev-parse', 'refs/remotes/origin/main'])).toBe(local);
		expect(await must(repo, ['rev-list', '--count', 'origin/main..HEAD'])).toBe('0');
		expect(await undoHead(repo.ports)).toBeUndefined();
		expect(await redoHead(repo.ports)).toBeUndefined();
		expect((await readOperationLog(repo.ports)).map(entry => [entry.record.kind, entry.expired])).toEqual([
			['create-checkpoints', true], ['create-checkpoints', true], ['send-changes', true],
		]);
	});

	test('a send that reports success but leaves the upstream without the checkpoints is not-sent and keeps both lists', async () => {
		const { repo } = await sharedProject(repos);
		await repo.write('c.txt', 'mine\n');
		doneId(await createCheckpoints(repo.ports, (await readChanges(repo.ports)).basis, [{ title: 'Add c.txt', body: '', hunkIds: [], wholeFiles: ['c.txt'] }]));
		const undoBefore = await undoHead(repo.ports);
		const shared = await must(repo, ['rev-parse', 'refs/remotes/origin/main']);
		// The checkpoints go to a branch of another name, which is not the upstream.
		const push = async (branch: string) => {
			await must(repo, ['push', '-q', 'origin', `${branch}:elsewhere`]);
			return { ok: true } as const;
		};
		const elsewhere = { ...repo.ports, network: { ...repo.ports.network, push } };

		const result = await sendChanges(elsewhere);

		expect(result).toEqual({ kind: 'rejected', reason: 'unknown', detail: 'not-sent' });
		expect(await must(repo, ['rev-parse', 'refs/remotes/origin/main'])).toBe(shared);
		expect(await undoHead(repo.ports)).toEqual(undoBefore);
		expect((await readOperationLog(repo.ports)).map(entry => entry.record.kind)).toEqual(['create-checkpoints']);
	});

	test('sendChanges when the shared copy moved returns rejected shared-copy-moved', async () => {
		const { repo, maya } = await sharedProject(repos);
		await maya.write('b.txt', 'theirs\n');
		await maya.commit('Their change');
		await repo.pushFrom(maya);
		await repo.write('c.txt', 'mine\n');
		const mine = await repo.commit('Mine');

		const result = await sendChanges(repo.ports);

		expect(result).toMatchObject({ kind: 'rejected', reason: 'shared-copy-moved' });
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(mine);
		expect(await readRecords(repo.ports)).toEqual([]);
	});

	test('sendChanges with nothing to send, or with no shared copy, changes nothing', async () => {
		const { repo } = await sharedProject(repos);
		expect(await sendChanges(repo.ports)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });

		const alone = await tempRepo();
		repos.push(alone);
		await alone.write('a.txt', 'one\n');
		await alone.commit('A');
		expect(await sendChanges(alone.ports)).toMatchObject({ kind: 'rejected', reason: 'no-shared-copy' });
		expect(await readRecords(alone.ports)).toEqual([]);
	});

	test('after a file is added to a reviewed folder, a file-folder resolution is refused and nothing changes', async () => {
		const { repo, maya } = await sharedProject(repos, { ff: 'a file\n' });
		await mayaShares(repo, maya, { ff: 'their edit of the file\n' });
		await fsp.rm(path.join(repo.root, 'ff'));
		await repo.write('ff/inside.txt', 'in my folder\n');
		const { preview, resolution } = await resolve(repo, { type: 'take', side: 'theirs' });
		expect(preview.overlaps[0]).toMatchObject({ kind: 'file-folder', path: 'ff', fileSide: 'theirs' });
		await repo.write('ff/new.txt', 'added after the review\n');
		const before = await everything(repo);

		const result = await getIncoming(repo.ports, preview.basis, [resolution], []);

		expect(result).toMatchObject({ kind: 'inputs-changed', changed: ['files'] });
		if (result.kind === 'inputs-changed') {
			expect(result.preview.overlaps.map(overlap => overlap.id)).not.toContain(resolution.overlapId);
		}
		expect(await everything(repo)).toEqual(before);
	});

	test('an ignored file in a reviewed folder is not part of the basis, and a file over 5 MB counts by size and time', async () => {
		const { repo, maya } = await sharedProject(repos, { ff: 'a file\n' });
		await mayaShares(repo, maya, { ff: 'their edit of the file\n' });
		await fsp.rm(path.join(repo.root, 'ff'));
		await repo.write('ff/inside.txt', 'in my folder\n');
		const big = path.join(repo.root, 'ff', 'big.bin');
		await fsp.writeFile(big, Buffer.alloc(6 * 1024 * 1024, 1));
		const time = new Date('2026-01-02T00:00:00Z');
		await fsp.utimes(big, time, time);
		const { preview, resolution } = await resolve(repo, { type: 'take', side: 'theirs' });

		// The project ignores *.csv.
		await repo.write('ff/debug.csv', 'written by a tool\n');
		expect((await previewIncoming(repo.ports)).basis).toBe(preview.basis);
		// Other content of the same size, with the same time, is not read.
		await fsp.writeFile(big, Buffer.alloc(6 * 1024 * 1024, 2));
		await fsp.utimes(big, time, time);
		expect((await previewIncoming(repo.ports)).basis).toBe(preview.basis);
		await fsp.utimes(big, new Date('2026-01-03T00:00:00Z'), new Date('2026-01-03T00:00:00Z'));
		expect((await previewIncoming(repo.ports)).basis).not.toBe(preview.basis);
		await fsp.utimes(big, time, time);

		expect((await getIncoming(repo.ports, preview.basis, [resolution], [])).kind).not.toBe('inputs-changed');
	});

	/** A shared project where Maya and a local checkpoint of mine both changed data.bin and data2.bin. */
	const twoBinaryOverlaps = async () => {
		const project = await sharedProject(repos, { 'data.bin': 'base\0data', 'data2.bin': 'base\0two' });
		await mayaShares(project.repo, project.maya, { 'data.bin': 'theirs\0data', 'data2.bin': 'theirs\0two' });
		await project.repo.write('data.bin', 'mine\0data');
		await project.repo.write('data2.bin', 'mine\0two');
		await project.repo.commit('Mine');
		const preview = await previewIncoming(project.repo.ports);
		expect(preview.overlaps.map(overlap => [overlap.kind, overlap.path])).toEqual([['binary', 'data.bin'], ['binary', 'data2.bin']]);
		return { repo: project.repo, preview };
	};

	test('one new name used by two keep-both choices is refused and nothing changes', async () => {
		const { repo, preview } = await twoBinaryOverlaps();
		const before = await everything(repo);
		const resolutions: Resolution[] = preview.overlaps.map(overlap => ({ overlapId: overlap.id, choice: { type: 'keep-both', renamedSide: 'mine', newPath: 'same.bin' } }));

		expect(await getIncoming(repo.ports, preview.basis, resolutions, [])).toMatchObject({ kind: 'inputs-changed', changed: [] });

		expect(await everything(repo)).toEqual(before);
	});

	test('on a file system that ignores case, a new name equal to another name or overlap path in other case is refused', async () => {
		const { repo, preview } = await twoBinaryOverlaps();
		const before = await everything(repo);
		const ports = { ...repo.ports, files: { ...repo.ports.files, caseInsensitive: async () => true } };
		const [first, second] = preview.overlaps;
		const keepBoth = (newPath: string): OverlapChoice => ({ type: 'keep-both', renamedSide: 'mine', newPath });

		for (const resolutions of [
			[{ overlapId: first.id, choice: keepBoth('DATA2.bin') }, { overlapId: second.id, choice: { type: 'take', side: 'theirs' } }],
			[{ overlapId: first.id, choice: keepBoth('same.bin') }, { overlapId: second.id, choice: keepBoth('SAME.bin') }],
		] as Resolution[][]) {
			expect(await getIncoming(ports, preview.basis, resolutions, [])).toMatchObject({ kind: 'inputs-changed', changed: [] });
		}

		expect(await everything(repo)).toEqual(before);
	});

	test('an overlap of a later replay step comes with a basis that binds its paths', async () => {
		const { repo, maya } = await sharedProject(repos);
		await mayaShares(repo, maya, { 'a.txt': withLine(1, 'theirs'), 'b.txt': 'theirs\n' });
		await repo.write('a.txt', withLine(1, 'mine'));
		await repo.commit('Mine');
		await repo.write('b.txt', 'mine\n');
		const first = await resolve(repo, { type: 'take', side: 'theirs' });
		expect(first.preview.overlaps[0].path).toBe('a.txt');

		const stopped = await getIncoming(repo.ports, first.preview.basis, [first.resolution], []);

		expect(stopped.kind).toBe('overlaps');
		if (stopped.kind !== 'overlaps') {
			return;
		}
		expect(stopped.preview.overlaps.map(overlap => overlap.path)).toEqual(['b.txt']);
		const second: Resolution = { overlapId: stopped.preview.overlaps[0].id, choice: { type: 'take', side: 'mine' } };
		await repo.write('b.txt', 'mine, edited after the review\n');
		const before = await everything(repo);

		expect(await getIncoming(repo.ports, stopped.preview.basis, [first.resolution, second], [])).toMatchObject({ kind: 'inputs-changed', changed: ['files'] });

		expect(await everything(repo)).toEqual(before);
	});

	test('replayed checkpoints keep the record of files they took only part of', async () => {
		const long = Array.from({ length: 20 }, (_, index) => `row ${index + 1}`);
		const { repo, maya } = await sharedProject(repos, { 'c.txt': text(long) });
		await mayaShares(repo, maya, { 'b.txt': 'theirs\n' });
		await repo.write('c.txt', text(long.map((line, index) => index === 0 || index === 19 ? `${line} mine` : line)));
		const changes = await readChanges(repo.ports);
		const hunks = changes.files.find(file => file.path === 'c.txt')!.hunks;
		expect(hunks).toHaveLength(2);
		doneId(await createCheckpoints(repo.ports, changes.basis, [{ title: 'Part of c', body: '', hunkIds: [hunks[0].id], wholeFiles: [] }]));

		doneId(await getIncoming(repo.ports, (await previewIncoming(repo.ports)).basis, [], []));

		const head = await must(repo, ['rev-parse', 'HEAD']);
		expect(await must(repo, ['log', '-1', '--format=%s', head])).toBe('Part of c');
		expect((await readPartialFiles(repo.ports)).get(head)).toEqual(['c.txt']);
	});

	test.skipIf(process.platform === 'win32')('replayed checkpoints are signed when commit.gpgsign is set', async () => {
		const { repo, maya } = await sharedProject(repos);
		await mayaShares(repo, maya, { 'b.txt': 'theirs\n' });
		await repo.write('c.txt', 'mine\n');
		await repo.commit('Mine');
		const stub = path.join(repo.root, '.git', 'gpg-stub.sh');
		await fsp.writeFile(stub, [
			'#!/bin/sh',
			'cat > /dev/null',
			'echo "[GNUPG:] SIG_CREATED D 1 8 00 1700000000 0123456789ABCDEF" >&2',
			'echo "-----BEGIN PGP SIGNATURE-----"',
			'echo "stub"',
			'echo "-----END PGP SIGNATURE-----"',
			'',
		].join('\n'), { mode: 0o755 });
		await must(repo, ['config', 'commit.gpgsign', 'true']);
		await must(repo, ['config', 'gpg.program', stub]);

		doneId(await getIncoming(repo.ports, (await previewIncoming(repo.ports)).basis, [], []));

		expect(await must(repo, ['log', '-1', '--format=%s', 'HEAD'])).toBe('Mine');
		expect(await must(repo, ['cat-file', 'commit', 'HEAD'])).toContain('gpgsig -----BEGIN PGP SIGNATURE-----');
	});

	test('a send while another window holds the lock clears both lists, and the next expiry removes their snapshots', async () => {
		const { repo } = await sharedProject(repos);
		const checkpoint = async (file: string) => {
			await repo.write(file, 'mine\n');
			return doneId(await createCheckpoints(repo.ports, (await readChanges(repo.ports)).basis, [{ title: `Add ${file}`, body: '', hunkIds: [], wholeFiles: [file] }]));
		};
		const first = await checkpoint('c.txt');
		const second = await checkpoint('d.txt');
		const lock = (await acquireLock(await repo.freshPorts()))!;
		expect(lock).toBeDefined();

		const result = await sendChanges(repo.ports);

		expect(result).toEqual({ kind: 'done', operationId: '', hookEditedFiles: [] });
		expect(await undoHead(repo.ports)).toBeUndefined();
		expect(await redoHead(repo.ports)).toBeUndefined();
		const pending = `${await engineDirectory(repo.ports)}/operations-pending.json`;
		expect(JSON.parse(await fsp.readFile(pending, 'utf8'))).toEqual([first, second]);

		await lock.release();
		await expire(repo.ports);

		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${first}`)).toBe(false);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${second}`)).toBe(false);
		expect(await fsp.stat(pending).catch(() => undefined)).toBeUndefined();
		expect(await undoHead(repo.ports)).toBeUndefined();
	});
});

/**
 * The mutating calls of a clean get-changes that replays two local checkpoints, measured once. Every call up to and including the
 * branch move is a point where getting the changes can fail.
 */
const referenceCalls = await (async () => {
	const repos: TempRepo[] = [];
	try {
		const { repo } = await cleanIncoming(repos, { localCheckpoints: true });
		const ports = faultPorts(repo.ports, {});
		doneId(await getIncoming(ports, (await previewIncoming(repo.ports)).basis, [], []));
		return ports.mutatingCalls;
	} finally {
		await Promise.all(repos.map(repo => repo.dispose()));
	}
})();
const branchMove = referenceCalls.indexOf('update-ref refs/heads/main') + 1;
const failurePoints = Array.from({ length: branchMove }, (_, index) => index + 1);

describe('get-changes failure injection', { timeout: 60_000 }, () => {
	test('the reference get-changes moves the branch after writing files', () => {
		expect(branchMove).toBeGreaterThan(5);
		expect(referenceCalls.slice(0, branchMove).some(call => /^move \.a\.txt\..*positron-checkpoints-tmp$/.test(call))).toBe(true);
	});

	test.each(failurePoints)('get-changes failing at mutating call %i restores the exact before state', async failAt => {
		const repos: TempRepo[] = [];
		try {
			const { repo } = await cleanIncoming(repos, { localCheckpoints: true });
			const { basis } = await previewIncoming(repo.ports);
			const before = await everything(repo);

			const result = await getIncoming(faultPorts(repo.ports, { failAt }), basis, [], []);

			expect(result.kind).toBe('could-not-finish');
			expect(await everything(repo)).toEqual(before);
			for (const record of await readRecords(repo.ports)) {
				expect(record.status).toBe('rolled-back');
			}
			expect(await fsp.stat(`${await engineDirectory(repo.ports)}/lock`).catch(() => undefined)).toBeUndefined();
			expect(await undoHead(repo.ports)).toBeUndefined();
		} finally {
			await Promise.all(repos.map(repo => repo.dispose()));
		}
	});
});
