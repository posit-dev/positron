/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import { editDescription } from './checkpoints';
import { createEngine } from './engine';
import { getHistory } from './history';
import { engineDirectory, readRecords } from './journal';
import { redo, undo, undoHead } from './operationLog';
import { proposalSlug, readProposal, sharedReference, startProposal } from './proposals';
import { recoverOnStart } from './recovery';
import { readRepoFacts } from './repoState';
import { faultPorts } from './test/faultPorts';
import { must, refExists } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { worktreeTree } from './trees';
import { OperationResult } from './types';

const PROPOSAL = 'proposal/fit-the-dose-model';

describe('proposalSlug', () => {
	test('keeps lower-case ASCII letters and digits, and makes each other run one hyphen', () => {
		expect(proposalSlug('Fit the dose model!')).toBe('fit-the-dose-model');
		expect(proposalSlug('  Plot 2: Résidus -- final  ')).toBe('plot-2-r-sidus-final');
	});

	test('a 60-character title gives 40 characters with no trailing hyphen', () => {
		const title = 'Fit the dose model with a random slope and plot the residuals';
		expect(title.length).toBeGreaterThanOrEqual(60);
		const slug = proposalSlug(title);
		expect(slug).toBe('fit-the-dose-model-with-a-random-slope-a');
		expect(slug.length).toBe(40);
		expect(proposalSlug('Fit the dose model with a random slopes and more')).toBe('fit-the-dose-model-with-a-random-slopes');
	});

	test('a title with no letter or digit gives changes', () => {
		expect(proposalSlug('???')).toBe('changes');
		expect(proposalSlug('')).toBe('changes');
	});
});

// Each test runs full operations, which exceed the default limit under a loaded test run.
describe('startProposal', { timeout: 60_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/**
	 * A project on `main` whose shared copy has checkpoint A, with the unshared checkpoints
	 * "Fit the dose model!" and "Add the residual plot", an unrecorded edit, and an untracked file.
	 */
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		const a = await repo.commit('A');
		repos.push(await repo.clone());
		await repo.write('a.txt', 'two\n');
		const b = await repo.commit('Fit the dose model!\n\nWith a random slope.');
		await repo.write('b.txt', 'plot\n');
		const c = await repo.commit('Add the residual plot');
		await repo.write('a.txt', 'two\nunrecorded\n');
		await repo.write('u.txt', 'untracked\n');
		return { repo, a, b, c };
	};

	/** HEAD, the refs and configuration a proposal changes, the index, and the working files. */
	const state = async (repo: TempRepo) => {
		const ref = async (name: string) => {
			const result = await repo.git(['rev-parse', '--verify', '-q', name]);
			return result.exitCode === 0 ? result.stdout.trim() : undefined;
		};
		return {
			head: await must(repo, ['symbolic-ref', 'HEAD']),
			main: await ref('refs/heads/main'),
			proposal: await ref(`refs/heads/${PROPOSAL}`),
			config: (await repo.git(['config', '--local', '--get-regexp', '^branch\\.proposal/'])).stdout,
			index: await must(repo, ['write-tree']),
			worktree: (await worktreeTree(repo.ports)).tree,
			untracked: await repo.read('u.txt'),
		};
	};

	const doneId = (result: OperationResult) => {
		expect(result.kind).toBe('done');
		return result.kind === 'done' ? result.operationId : '';
	};

	test('start puts the unshared checkpoints on proposal/<slug>, leaves files and index unchanged, and the base equals its upstream', async () => {
		const { repo, a, c } = await create();
		const before = await state(repo);

		doneId(await startProposal(repo.ports));

		expect(await state(repo)).toEqual({
			...before,
			head: `refs/heads/${PROPOSAL}`,
			main: a,
			proposal: c,
			config: `branch.${PROPOSAL}.positroncheckpointsbase main\n`,
		});
		expect(await must(repo, ['rev-parse', 'refs/remotes/origin/main'])).toBe(a);
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		const [record] = await readRecords(repo.ports);
		expect(record).toMatchObject({ kind: 'start-proposal', status: 'complete', commitPoint: 3 });
	});

	test.each([
		['a local', 'refs/heads/'],
		['a remote', 'refs/remotes/origin/'],
	])('start adds -2 when %s branch has the name', async (_label, prefix) => {
		const { repo, a, c } = await create();
		await must(repo, ['update-ref', `${prefix}${PROPOSAL}`, a]);

		doneId(await startProposal(repo.ports));

		expect(await must(repo, ['symbolic-ref', 'HEAD'])).toBe(`refs/heads/${PROPOSAL}-2`);
		expect(await must(repo, ['rev-parse', `refs/heads/${PROPOSAL}-2`])).toBe(c);
	});

	test('start adds -3 when the names with no suffix and with -2 are used', async () => {
		const { repo, a } = await create();
		await must(repo, ['update-ref', `refs/heads/${PROPOSAL}`, a]);
		await must(repo, ['update-ref', `refs/remotes/origin/${PROPOSAL}-2`, a]);

		doneId(await startProposal(repo.ports));

		expect(await must(repo, ['symbolic-ref', 'HEAD'])).toBe(`refs/heads/${PROPOSAL}-3`);
	});

	test('state reports proposal { branch, base: \'main\', sent: false } and sharedUrl', async () => {
		const { repo } = await create();
		const origin = await must(repo, ['config', '--get', 'remote.origin.url']);
		const engine = await createEngine(repo.ports);
		try {
			const plain = await engine.getState();
			expect(plain.proposal).toBeUndefined();
			expect(plain.sharedUrl).toBe(origin);

			doneId(await engine.startProposal());

			const started = await engine.getState();
			expect(started.branch).toBe(PROPOSAL);
			expect(started.proposal).toEqual({ branch: PROPOSAL, base: 'main', sent: false });
			expect(started.sharedUrl).toBe(origin);
			expect(started.undo?.kind).toBe('start-proposal');
			expect(await readProposal(repo.ports)).toEqual({ branch: PROPOSAL, base: 'main', sent: false });
		} finally {
			engine.dispose();
		}
	});

	test('a project with no remote origin reports no sharedUrl', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.commit('A');
		const engine = await createEngine(repo.ports);
		try {
			const result = await engine.getState();
			expect(result.sharedUrl).toBeUndefined();
			expect(result.proposal).toBeUndefined();
		} finally {
			engine.dispose();
		}
	});

	test('start is refused with nothing-to-do when nothing is unshared, and with proposal-exists on a proposal', async () => {
		const plain = await tempRepo();
		repos.push(plain);
		await plain.write('a.txt', 'one\n');
		await plain.commit('A');
		expect(await startProposal(plain.ports)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
		repos.push(await plain.clone());
		expect(await startProposal(plain.ports)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
		expect(await readRecords(plain.ports)).toEqual([]);

		const { repo } = await create();
		doneId(await startProposal(repo.ports));
		const started = await state(repo);
		expect(await startProposal(repo.ports)).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'proposal-exists' });
		expect(await state(repo)).toEqual(started);
	});

	test('the engine refuses start while busy and in an unusual state', async () => {
		const { repo, c } = await create();
		await must(repo, ['checkout', '-q', '--detach', c]);
		const engine = await createEngine(repo.ports);
		try {
			expect(await engine.startProposal()).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'detached' });
			await must(repo, ['checkout', '-q', 'main']);
			const first = engine.startProposal();
			expect(await engine.startProposal()).toEqual({ kind: 'unavailable', reason: 'busy' });
			doneId(await first);
		} finally {
			engine.dispose();
		}
	});

	test('finish and stop return unavailable through the engine', async () => {
		const { repo, c } = await create();
		const engine = await createEngine(repo.ports);
		try {
			expect(await engine.finishProposal(c)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
			expect(await engine.stopProposal()).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
		} finally {
			engine.dispose();
		}
	});

	test('an unsent proposal counts ahead against the base upstream, and edit, reverse, and go back treat base-upstream checkpoints as shared', async () => {
		const { repo, a, b, c } = await create();
		doneId(await startProposal(repo.ports));

		expect(await sharedReference(repo.ports)).toBe(a);
		expect(await sharedReference(repo.ports, 'main')).toBe(a);
		const facts = await readRepoFacts(repo.ports);
		expect(facts).toMatchObject({ branch: PROPOSAL, upstream: 'origin/main', ahead: 2, behind: 0 });
		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => [checkpoint.id, checkpoint.shared])).toEqual([[c, false], [b, false], [a, true]]);
		expect(await editDescription(repo.ports, a, 'New title', '')).toEqual({ kind: 'unavailable', reason: 'shared-checkpoint' });
		doneId(await editDescription(repo.ports, b, 'Fit the dose model', 'Reworded.'));
	});

	test('behind counts against the base upstream of an unsent proposal', async () => {
		const { repo } = await create();
		const colleague = await repo.clone();
		repos.push(colleague);
		await colleague.write('c.txt', 'theirs\n');
		await colleague.commit('Theirs');
		await repo.pushFrom(colleague);
		doneId(await startProposal(repo.ports));
		await must(repo, ['fetch', '-q']);

		expect(await readRepoFacts(repo.ports)).toMatchObject({ upstream: 'origin/main', ahead: 2, behind: 1 });
	});

	/** The mutating calls of a start that runs to the end, from a fresh project. */
	const referenceCalls = async () => {
		const { repo } = await create();
		const ports = faultPorts(repo.ports, {});
		doneId(await startProposal(ports));
		return ports.mutatingCalls;
	};

	test('a fault at each step restores the exact state before', async () => {
		const calls = await referenceCalls();
		const commitPoint = calls.findIndex(call => /^update-ref refs\/heads\/main$/.test(call)) + 1;
		expect(commitPoint).toBeGreaterThan(0);
		// Each step of the operation, up to and including the base move.
		const steps = [
			calls.findIndex(call => call === `update-ref refs/heads/${PROPOSAL}`) + 1,
			calls.findIndex(call => call.startsWith(`config branch.${PROPOSAL}.`)) + 1,
			calls.findIndex(call => call.startsWith('symbolic-ref HEAD')) + 1,
			commitPoint,
		];
		expect(steps.every(step => step > 0)).toBe(true);

		for (const failAt of steps) {
			const { repo } = await create();
			const before = await state(repo);
			const result = await startProposal(faultPorts(repo.ports, { failAt }));
			expect(result.kind, `fault at call ${failAt}`).toBe('could-not-finish');
			expect(await state(repo)).toEqual(before);
			expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
		}

		for (const stopAt of steps) {
			const { repo } = await create();
			const before = await state(repo);
			// After a simulated crash every call fails, so the result says nothing; recovery decides.
			await startProposal(faultPorts(repo.ports, { stopAt })).catch(() => undefined);
			expect((await readRecords(repo.ports))[0].status, `crash at call ${stopAt}`).toBe('prepared');
			await fsp.rm(`${await engineDirectory(repo.ports)}/lock`, { force: true });
			expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'reversed' });
			expect(await state(repo)).toEqual(before);
		}
	});

	test('undo of start restores the prior branch state; redo starts it again', async () => {
		const { repo } = await create();
		const before = await state(repo);
		const id = doneId(await startProposal(repo.ports));
		const started = await state(repo);
		expect((await undoHead(repo.ports))?.id).toBe(id);

		doneId(await undo(repo.ports, id, []));
		expect(await state(repo)).toEqual(before);
		expect(await refExists(repo, `refs/heads/${PROPOSAL}`)).toBe(false);
		expect(await readProposal(repo.ports)).toBeUndefined();

		doneId(await redo(repo.ports, id, []));
		expect(await state(repo)).toEqual(started);
		expect(await readProposal(repo.ports)).toEqual({ branch: PROPOSAL, base: 'main', sent: false });
	});
});
