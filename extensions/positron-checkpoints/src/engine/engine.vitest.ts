/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { createEngine, Engine } from './engine';
import { createGitRunner } from './git';
import { JournalRecord, writeRecord } from './journal';
import { EnginePorts, GitRunner } from './ports';
import { currentState, must } from './test/operationFixtures';
import { LINES, text, withLine } from './test/syncFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { Chunk, EngineState, OperationResult } from './types';

describe('engine', { timeout: 120_000 }, () => {
	const repos: TempRepo[] = [];
	const engines: Engine[] = [];

	afterEach(async () => {
		engines.splice(0).forEach(engine => engine.dispose());
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	const start = async (ports: EnginePorts) => {
		const engine = await createEngine(ports);
		engines.push(engine);
		return engine;
	};

	/** A project with a.txt "one" and b.txt "bee" in checkpoint A. */
	const project = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.write('b.txt', 'bee\n');
		const a = await repo.commit('A');
		return { repo, a, root: await must(repo, ['rev-parse', '--show-toplevel']) };
	};

	const doneId = (result: OperationResult): string => {
		if (result.kind !== 'done') {
			throw new Error(`the operation did not finish: ${JSON.stringify(result)}`);
		}
		return result.operationId;
	};

	/** Creates one checkpoint of the whole files `files` through the engine. */
	const checkpoint = async (engine: Engine, title: string, files: string[]) => {
		const changes = await engine.getChanges();
		const chunk: Chunk = { title, body: '', hunkIds: [], wholeFiles: files };
		return doneId(await engine.createCheckpoints(changes.basis, [chunk]));
	};

	/** The state of a tracked project with nothing to report. */
	const cleanState = (root: string): EngineState => ({
		tracking: 'tracking', projectName: path.basename(root), projectRoot: root, openedFolderIsInsideProject: false,
		branch: 'main', shared: { exists: false, ahead: 0, behind: 0 }, identityMissing: false, syncAvailable: true,
		requiredGitVersion: '2.40', pendingOverlap: false, recoverySnapshots: [], keptFileCount: 0,
	});

	/** Writes a journal record about the project as it is now, as a crashed or interrupted action leaves one. */
	const leaveRecord = async (repo: TempRepo, status: JournalRecord['status'], changes: Partial<JournalRecord> = {}) => {
		const state = await currentState(repo);
		await writeRecord(repo.ports, {
			id: 'crashed', kind: 'go-back', description: 'Go back to "A"', time: repo.ports.now().toISOString(), branch: 'main',
			before: state, after: state, paths: [], skipped: [], keptMoves: [], progress: [], status, ...changes,
		});
	};

	test('getState for a plain folder, a clean project, and each unusual kind', async () => {
		const plain = await tempRepo({ init: 'none' });
		repos.push(plain);
		expect(await (await start(plain.ports)).getState()).toEqual({
			tracking: 'not-a-project', projectName: path.basename(plain.root), projectRoot: plain.root, openedFolderIsInsideProject: false,
			// Test repositories read no global configuration, so git has no identity there.
			shared: { exists: false, ahead: 0, behind: 0 }, identityMissing: true, syncAvailable: true, requiredGitVersion: '2.40',
			pendingOverlap: false, recoverySnapshots: [], keptFileCount: 0,
		});

		const { repo, a, root } = await project();
		const engine = await start(repo.ports);
		expect(await engine.getState()).toEqual(cleanState(root));

		await fsp.writeFile(path.join(root, '.git', 'MERGE_HEAD'), `${a}\n`);
		expect(await engine.getState()).toEqual({ ...cleanState(root), unusual: { kind: 'operation-in-progress', detail: 'MERGE_HEAD' } });
		await fsp.rm(path.join(root, '.git', 'MERGE_HEAD'));

		await repo.write('a.txt', 'staged\n');
		await must(repo, ['add', 'a.txt']);
		await repo.write('a.txt', 'on disk\n');
		expect(await engine.getState()).toEqual({ ...cleanState(root), unusual: { kind: 'staged-differs', detail: 'a.txt' } });
		await must(repo, ['reset', '-q', '--hard']);

		await must(repo, ['checkout', '-q', '--detach']);
		const { branch: _branch, ...detached } = cleanState(root);
		expect(await engine.getState()).toEqual({ ...detached, unusual: { kind: 'detached', detail: 'HEAD does not point at a branch' } });
		await must(repo, ['checkout', '-q', 'main']);

		const missingGit: EnginePorts = { ...repo.ports, git: createGitRunner(path.join(root, 'no-such-git'), root) };
		const withoutGit = await (await start(missingGit)).getState();
		expect(withoutGit).toMatchObject({ tracking: 'not-a-project', syncAvailable: false, unusual: { kind: 'git-missing' } });

		// The branch is at neither commit of the record, so recovery cannot decide.
		const state = await currentState(repo);
		await leaveRecord(repo, 'prepared', { before: { ...state, branchCommit: 'f'.repeat(40) }, after: { ...state, branchCommit: 'e'.repeat(40) } });
		const unrecovered = await (await start(await repo.freshPorts())).getState();
		expect(unrecovered).toEqual({
			...cleanState(root),
			unusual: { kind: 'unrecovered', detail: expect.stringContaining('refs/positron-checkpoints/recovery/crashed') },
			recoverySnapshots: [{ operationId: 'crashed', time: '2026-01-01T00:00:00.000Z' }],
		});
	});

	test('state reports undo and redo heads with descriptions', async () => {
		const { repo, a } = await project();
		const engine = await start(repo.ports);
		await repo.write('a.txt', 'two\n');
		const created = await checkpoint(engine, 'Edit a', ['a.txt']);
		const wentBack = doneId(await engine.goBackTo(a, []));

		const state = await engine.getState();
		expect([state.undo, state.redo]).toEqual([{ operationId: wentBack, description: 'Go back to "A"', kind: 'go-back', restoresFiles: true }, undefined]);

		doneId(await engine.undo(wentBack, []));
		doneId(await engine.undo(created, []));
		const undone = await engine.getState();
		expect([undone.undo, undone.redo]).toEqual([
			undefined,
			{ operationId: created, description: 'Create checkpoint "Edit a"', kind: 'create-checkpoints', restoresFiles: false },
		]);
	});

	test('mutating calls are refused in an unusual state', async () => {
		const { repo, a } = await project();
		const engine = await start(repo.ports);
		await repo.write('a.txt', 'two\n');
		const basis = (await engine.getChanges()).basis;
		await must(repo, ['checkout', '-q', '--detach']);

		const refused = { kind: 'unavailable', reason: 'unusual-state', detail: 'detached' };
		expect(await engine.createCheckpoints(basis, [{ title: 'Edit a', body: '', hunkIds: [], wholeFiles: ['a.txt'] }])).toEqual(refused);
		expect(await engine.goBackTo(a, [])).toEqual(refused);
		expect(await engine.checkShared()).toEqual(refused);
		expect(await engine.startTracking()).toEqual(refused);
		expect(await repo.read('a.txt')).toBe('two\n');
		expect(await must(repo, ['rev-parse', 'HEAD'])).toBe(a);

		const plain = await tempRepo({ init: 'none' });
		repos.push(plain);
		const plainEngine = await start(plain.ports);
		expect(await plainEngine.goBackTo(a, [])).toEqual({ kind: 'unavailable', reason: 'not-tracking' });
		expect(await plainEngine.getHistory(0, 10)).toEqual([]);
		expect(await plainEngine.getChanges()).toEqual({ basis: '', files: [] });
	});

	test('two concurrent mutating calls: the second is busy', async () => {
		const { repo } = await project();
		const engine = await start(repo.ports);
		await repo.write('a.txt', 'two\n');
		const basis = (await engine.getChanges()).basis;

		const first = engine.createCheckpoints(basis, [{ title: 'Edit a', body: '', hunkIds: [], wholeFiles: ['a.txt'] }]);
		const second = engine.reverseCheckpoint('0'.repeat(40));

		expect(await second).toEqual({ kind: 'unavailable', reason: 'busy' });
		expect((await first).kind).toBe('done');
		// Once the first call ends, the next one runs.
		expect(await engine.reverseCheckpoint('0'.repeat(40))).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'not-in-history' });
	});

	test('idle resolves once the mutating call that runs has ended', async () => {
		const { repo } = await project();
		await repo.clone().then(clone => repos.push(clone));
		let reachPush: () => void = () => { };
		const pushReached = new Promise<void>(resolve => { reachPush = resolve; });
		let releasePush: () => void = () => { };
		const pushReleased = new Promise<void>(resolve => { releasePush = resolve; });
		const network = {
			...repo.ports.network,
			push: async (branch: string) => {
				reachPush();
				await pushReleased;
				return repo.ports.network.push(branch);
			},
		};
		const engine = await start({ ...repo.ports, network });
		await repo.write('a.txt', 'two\n');
		await checkpoint(engine, 'Edit a', ['a.txt']);
		await engine.idle();

		const sending = engine.sendChanges();
		await pushReached;
		let idle = false;
		const waiting = engine.idle().then(() => { idle = true; });
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(idle).toBe(false);

		releasePush();
		await waiting;
		expect((await sending).kind).toBe('done');
	});

	test('onDidChangeState fires after each mutating call and after notifyChanged', async () => {
		const { repo, a } = await project();
		const engine = await start(repo.ports);
		let fired = 0;
		const listener = engine.onDidChangeState(() => fired++);

		await repo.write('a.txt', 'two\n');
		await checkpoint(engine, 'Edit a', ['a.txt']);
		expect(fired).toBe(1);
		await engine.goBackTo(a, []);
		expect(fired).toBe(2);
		await engine.getState();
		await engine.getHistory(0, 10);
		expect(fired).toBe(2);
		engine.notifyChanged();
		expect(fired).toBe(3);

		listener.dispose();
		engine.notifyChanged();
		expect(fired).toBe(3);
	});

	test('an interrupted record makes other calls busy until resolveInterrupted', async () => {
		const { repo, a } = await project();
		const blob = (content: string) => must(repo, ['hash-object', '-w', '--stdin'], { stdin: content });
		// The action wrote a.txt, and another tool changed it afterwards.
		await leaveRecord(repo, 'prepared', {
			paths: [{ path: 'a.txt', before: await blob('one\n'), after: await blob('two\n'), beforeMode: '100644', afterMode: '100644' }],
			progress: [{ step: 'path', path: 'a.txt' }],
		});
		await repo.write('a.txt', 'three\n');
		const engine = await start(repo.ports);

		const state = await engine.getState();
		expect(state.interrupted).toEqual({ operationId: 'crashed', description: 'Go back to "A"', unexpectedPaths: ['a.txt'], indexUnexpected: false });
		expect(state.unusual).toBeUndefined();
		// Each state classifies the record's paths as they are now.
		await repo.write('a.txt', 'two\n');
		expect((await engine.getState()).interrupted?.unexpectedPaths).toEqual([]);
		await repo.write('a.txt', 'three\n');
		expect((await engine.getState()).interrupted?.unexpectedPaths).toEqual(['a.txt']);
		const busy = { kind: 'unavailable', reason: 'busy', detail: 'unresolved-operation' };
		expect(await engine.goBackTo(a, [])).toEqual(busy);
		await expect(engine.removeRecoverySnapshot('crashed')).rejects.toThrow();

		expect(await engine.resolveInterrupted('leave-as-is')).toEqual({ kind: 'done', operationId: 'crashed', hookEditedFiles: [] });
		const resolved = await engine.getState();
		expect([resolved.interrupted, resolved.recoverySnapshots.map(snapshot => snapshot.operationId)]).toEqual([undefined, ['crashed']]);
		expect(await repo.read('a.txt')).toBe('three\n');
		await engine.removeRecoverySnapshot('crashed');
		expect((await engine.getState()).recoverySnapshots).toEqual([]);
		doneId(await engine.goBackTo(a, []));
	});

	test('recoveryNotice is reported once', async () => {
		const { repo } = await project();
		// An action that stopped before it changed anything is reversed at startup.
		await leaveRecord(repo, 'prepared');
		const engine = await start(repo.ports);

		expect((await engine.getState()).recoveryNotice).toBe('reversed');
		expect((await engine.getState()).recoveryNotice).toBeUndefined();
	});

	test('recoveryNotice stays until a state is built', async () => {
		const { repo } = await project();
		await leaveRecord(repo, 'prepared');
		let fail = false;
		// The refs are listed late in building the state, after the repository facts are read.
		const git: GitRunner = (args, options) => fail && args.includes('for-each-ref') ? Promise.reject(new Error('disk full')) : repo.ports.git(args, options);
		const engine = await start({ ...repo.ports, git });

		fail = true;
		await expect(engine.getState()).rejects.toThrow('disk full');
		fail = false;

		expect((await engine.getState()).recoveryNotice).toBe('reversed');
		expect((await engine.getState()).recoveryNotice).toBeUndefined();
	});

	test('checkShared runs beside a mutating call, and a second checkShared shares the first', async () => {
		const { repo, a } = await project();
		/** Each fetch waits until the test answers it; `reached` resolves with the answer. */
		let reached: Promise<() => void> = Promise.resolve(() => { });
		let reach: (answer: () => void) => void = () => { };
		const nextFetch = () => {
			reached = new Promise(resolve => { reach = resolve; });
		};
		let fetches = 0;
		const network = {
			...repo.ports.network,
			fetch: async () => {
				fetches++;
				await new Promise<void>(resolve => reach(resolve));
				return { ok: true } as const;
			},
		};
		const engine = await start({ ...repo.ports, network });
		await repo.write('a.txt', 'two\n');
		await checkpoint(engine, 'Edit a', ['a.txt']);

		nextFetch();
		const first = engine.checkShared();
		expect(engine.checkShared()).toBe(first);
		const answerFirst = await reached;
		// The person's next action runs while the check waits for the network.
		doneId(await engine.goBackTo(a, []));
		answerFirst();
		expect(await first).toMatchObject({ kind: 'done' });

		nextFetch();
		const later = engine.checkShared();
		expect(later).not.toBe(first);
		(await reached)();
		expect(await later).toMatchObject({ kind: 'done' });
		expect(fetches).toBe(2);
	});

	test('a read call whose git call times out or cannot start rejects with a typed message', async () => {
		const { repo, a } = await project();
		let answer: 'normal' | 'timed-out' | 'missing' | 'failing' = 'normal';
		const git: GitRunner = (args, options) => {
			switch (answer) {
				case 'timed-out': return Promise.resolve({ stdout: '', stderr: '', exitCode: 1, timedOut: true });
				case 'missing': return Promise.resolve({ stdout: '', stderr: 'spawn git ENOENT', exitCode: -1, timedOut: false });
				case 'failing': return Promise.reject(new Error('disk full'));
				default: return repo.ports.git(args, options);
			}
		};
		const engine = await start({ ...repo.ports, git });
		const blob = await must(repo, ['rev-parse', `${a}:a.txt`]);
		const reads: [string, () => Promise<unknown>][] = [
			['getState', () => engine.getState()],
			['getHistory', () => engine.getHistory(0, 10)],
			['getChanges', () => engine.getChanges()],
			['getCheckpointFiles', () => engine.getCheckpointFiles(a)],
			['getPendingFiles', () => engine.getPendingFiles('token')],
			['getDiff', () => engine.getDiff({ kind: 'checkpoint', id: a, path: 'a.txt' })],
			['readBlob', () => engine.readBlob(blob)],
			['previewIncoming', () => engine.previewIncoming()],
			['getKeptFiles', () => engine.getKeptFiles()],
		];
		const outcome = async (call: () => Promise<unknown>) => call().then(() => 'resolved', (error: Error) => error.message);

		answer = 'timed-out';
		for (const [name, call] of reads) {
			expect([name, await outcome(call)]).toEqual([name, expect.stringMatching(/^checkpoints:timed-out: git .* did not respond in time$/)]);
		}
		answer = 'missing';
		for (const [name, call] of reads) {
			// The state reports a missing git program as an unusual state.
			const expected = name === 'getState' ? 'resolved' : 'checkpoints:git-missing: spawn git ENOENT';
			expect([name, await outcome(call)]).toEqual([name, expected]);
		}
		answer = 'failing';
		for (const [name, call] of reads) {
			expect([name, await outcome(call)]).toEqual([name, 'disk full']);
		}
		answer = 'normal';
		expect((await engine.getState()).tracking).toBe('tracking');
	});

	// Review Focus 4.
	test('a git call that never answers becomes unavailable timed-out', async () => {
		const { repo, root } = await project();
		const hang = createGitRunner('git', root);
		let stall = false;
		// While `stall` is set, git's object listing waits as git does for a password, and the runner stops it at its time limit.
		const git: GitRunner = (args, options) => stall && args.includes('ls-files')
			? hang(['-c', 'alias.wait=!sleep 30', 'wait'], { timeoutMs: 300 })
			: repo.ports.git(args, options);
		const engine = await start({ ...repo.ports, git });
		await repo.write('a.txt', 'two\n');
		const basis = (await engine.getChanges()).basis;

		stall = true;
		const result = await engine.createCheckpoints(basis, [{ title: 'Edit a', body: '', hunkIds: [], wholeFiles: ['a.txt'] }]);

		expect(result).toMatchObject({ kind: 'unavailable', reason: 'timed-out' });
		stall = false;
		expect((await engine.getState()).undo).toBeUndefined();
	});

	test('an unexpected error is logged and becomes could-not-finish', async () => {
		const { repo } = await project();
		const messages: string[] = [];
		let fail = false;
		const git: GitRunner = (args, options) => fail && args.includes('diff-tree') ? Promise.reject(new Error('disk full')) : repo.ports.git(args, options);
		const engine = await start({ ...repo.ports, git, log: message => messages.push(message) });
		await repo.write('a.txt', 'two\n');

		fail = true;
		expect(await engine.createCheckpoints('basis', [{ title: 'Edit a', body: '', hunkIds: [], wholeFiles: ['a.txt'] }])).toEqual({ kind: 'could-not-finish', detail: 'disk full' });
		expect(messages).toEqual([expect.stringContaining('disk full')]);
	});

	test('me and a colleague: checkpoint, send, colleague changes, get, overlap, resolve, undo, redo', async () => {
		// I start a project, and Maya works in a clone of it.
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', text(LINES));
		await repo.commit('Start');
		const maya = await repo.clone();
		await must(maya, ['config', 'user.name', 'Maya']);
		await must(maya, ['config', 'user.email', 'maya@example.com']);
		const me = await start(repo.ports);
		const colleague = await start(maya.ports);
		expect((await me.getState()).shared).toEqual({ exists: true, ahead: 0, behind: 0, name: 'origin/main' });

		// I edit line 1 and keep a checkpoint, then send it.
		await repo.write('a.txt', withLine(0, 'my first line'));
		await checkpoint(me, 'Change the first line', ['a.txt']);
		expect((await me.getState()).shared).toMatchObject({ ahead: 1, behind: 0 });
		doneId(await me.sendChanges());
		const sent = await me.getState();
		expect(sent.shared).toMatchObject({ ahead: 0, behind: 0, lastChecked: '2026-01-01T00:00:00.000Z' });
		// Sending cannot be undone, and clears the list.
		expect(sent.undo).toBeUndefined();

		// Maya gets my checkpoint, changes line 2, and sends it.
		doneId(await colleague.checkShared());
		const mayaPreview = await colleague.previewIncoming();
		expect(mayaPreview.incoming.map(incoming => [incoming.title, incoming.authorIsMe])).toEqual([['Change the first line', false]]);
		doneId(await colleague.getIncoming(mayaPreview.basis, [], []));
		expect(await maya.read('a.txt')).toBe(withLine(0, 'my first line'));
		await maya.write('a.txt', text(['my first line', 'her second line', ...LINES.slice(2)]));
		await checkpoint(colleague, 'Change the second line', ['a.txt']);
		doneId(await colleague.sendChanges());

		// Meanwhile I edit line 2 too, without a checkpoint.
		const mine = text(['my first line', 'my second line', ...LINES.slice(2)]);
		await repo.write('a.txt', mine);
		doneId(await me.checkShared());
		expect((await me.getState()).shared).toMatchObject({ ahead: 0, behind: 1 });

		// The preview finds the overlap, and the state keeps it pending.
		const preview = await me.previewIncoming();
		expect(preview.incoming.map(incoming => [incoming.title, incoming.authorName])).toEqual([['Change the second line', 'Maya']]);
		expect(preview.touchesLocalWork).toBe(true);
		expect(preview.overlaps).toMatchObject([{ kind: 'text', path: 'a.txt', theirAuthor: 'Maya' }]);
		expect((await me.getState()).pendingOverlap).toBe(true);
		const getWithoutChoice = await me.getIncoming(preview.basis, [], []);
		expect(getWithoutChoice.kind).toBe('overlaps');
		expect(await repo.read('a.txt')).toBe(mine);

		// I combine both second lines.
		const combined = text(['my first line', 'her second line, and mine', ...LINES.slice(2)]);
		const got = doneId(await me.getIncoming(preview.basis, [{ overlapId: preview.overlaps[0].id, choice: { type: 'text', content: combined } }], []));
		const afterGet = await me.getState();
		expect(afterGet).toMatchObject({ pendingOverlap: false, shared: { ahead: 0, behind: 0 }, undo: { operationId: got, kind: 'get-changes', restoresFiles: true } });
		expect(afterGet.undo?.description).toBe('Get changes from Maya');
		expect(await repo.read('a.txt')).toBe(combined);
		expect((await me.getHistory(0, 10)).map(entry => entry.title)).toEqual(['Change the second line', 'Change the first line', 'Start']);
		// My combined line is not in a checkpoint yet.
		expect((await me.getChanges()).files.map(file => file.path)).toEqual(['a.txt']);

		// Undo returns my files and my history as they were before I got her changes.
		const beforeUndo = await must(repo, ['rev-parse', 'HEAD']);
		doneId(await me.undo(got, []));
		expect(await repo.read('a.txt')).toBe(mine);
		expect((await me.getHistory(0, 10)).map(entry => entry.title)).toEqual(['Change the first line', 'Start']);
		expect((await me.getState()).redo).toMatchObject({ operationId: got, kind: 'get-changes' });

		// Redo brings back her checkpoint and my combined line.
		doneId(await me.redo(got, []));
		expect(await repo.read('a.txt')).toBe(combined);
		expect(await must(repo, ['rev-parse', 'HEAD'])).toBe(beforeUndo);
		const final = await me.getState();
		expect([final.undo?.operationId, final.redo, final.unusual, final.interrupted]).toEqual([got, undefined, undefined, undefined]);
	});
});
