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
import { redo, redoHead, undo, undoHead } from './operationLog';
import { EnginePorts } from './ports';
import { acceptedThrough, finishProposal, proposalSlug, proposalSuffix, readProposal, sharedReference, startProposal, stopProposal } from './proposals';
import { recoverOnStart } from './recovery';
import { readRepoFacts } from './repoState';
import { checkShared, getIncoming, previewIncoming, sendChanges } from './sync';
import { faultPorts } from './test/faultPorts';
import { afterJournal, must, refExists } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { worktreeTree } from './trees';
import { OperationResult } from './types';

/** The name of the proposal `create()` gives, started as the project's first operation (id `op-1`). */
const PROPOSAL = `proposal/fit-the-dose-model-${proposalSuffix('op-1')}`;

describe('proposalSuffix', () => {
	test('takes the first six hex characters of a hex id, and hashes any other id, the same way each time', () => {
		expect(proposalSuffix('3F2A9C1E-0000-4000-8000-000000000000')).toBe('3f2a9c');
		expect(proposalSuffix('op-1')).toMatch(/^[0-9a-f]{6}$/);
		expect(proposalSuffix('op-1')).toBe(proposalSuffix('op-1'));
		expect(proposalSuffix('op-2')).not.toBe(proposalSuffix('op-1'));
	});
});

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

const repos: TempRepo[] = [];

afterEach(async () => {
	await Promise.all(repos.splice(0).map(repo => repo.dispose()));
});

/**
 * A project on `main` whose shared copy has checkpoint A, with the unshared checkpoints
 * "Fit the dose model!" and "Add the residual plot", an unrecorded edit, and an untracked file.
 * With `sameLines`, the second checkpoint changes the line of a.txt that the first one changed
 * (to "three") instead of adding b.txt.
 */
async function create(sameLines = false) {
	const repo = await tempRepo();
	repos.push(repo);
	await repo.write('a.txt', 'one\n');
	const a = await repo.commit('A');
	repos.push(await repo.clone());
	await repo.write('a.txt', 'two\n');
	const b = await repo.commit('Fit the dose model!\n\nWith a random slope.');
	await repo.write(sameLines ? 'a.txt' : 'b.txt', sameLines ? 'three\n' : 'plot\n');
	const c = await repo.commit('Add the residual plot');
	await repo.write('a.txt', sameLines ? 'three\nunrecorded\n' : 'two\nunrecorded\n');
	await repo.write('u.txt', 'untracked\n');
	return { repo, a, b, c };
}

/** The text of the accepted record in the engine's folder, or undefined. */
async function acceptedFile(repo: TempRepo): Promise<string | undefined> {
	return fsp.readFile(`${await engineDirectory(repo.ports)}/accepted.json`, 'utf8').catch(() => undefined);
}

/** HEAD, the refs and configuration a proposal changes, the accepted record, the index, and the working files. */
async function state(repo: TempRepo) {
	const ref = async (name: string) => {
		const result = await repo.git(['rev-parse', '--verify', '-q', name]);
		return result.exitCode === 0 ? result.stdout.trim() : undefined;
	};
	return {
		head: await must(repo, ['symbolic-ref', 'HEAD']),
		main: await ref('refs/heads/main'),
		proposal: await ref(`refs/heads/${PROPOSAL}`),
		config: (await repo.git(['config', '--local', '--get-regexp', '^branch\\.proposal/'])).stdout,
		accepted: await acceptedFile(repo),
		index: await must(repo, ['write-tree']),
		worktree: (await worktreeTree(repo.ports)).tree,
		untracked: await repo.read('u.txt'),
	};
}

function doneId(result: OperationResult): string {
	expect(result.kind).toBe('done');
	return result.kind === 'done' ? result.operationId : '';
}

// Each test runs full operations, which exceed the default limit under a loaded test run.
describe('startProposal', { timeout: 60_000 }, () => {
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
	])('start adds -2 when %s branch has the exact name', async (_label, prefix) => {
		const { repo, a, c } = await create();
		await must(repo, ['update-ref', `${prefix}${PROPOSAL}`, a]);

		doneId(await startProposal(repo.ports));

		expect(await must(repo, ['symbolic-ref', 'HEAD'])).toBe(`refs/heads/${PROPOSAL}-2`);
		expect(await must(repo, ['rev-parse', `refs/heads/${PROPOSAL}-2`])).toBe(c);
	});

	test('start adds -3 when the exact name and the name with -2 are used', async () => {
		const { repo, a } = await create();
		await must(repo, ['update-ref', `refs/heads/${PROPOSAL}`, a]);
		await must(repo, ['update-ref', `refs/remotes/origin/${PROPOSAL}-2`, a]);

		doneId(await startProposal(repo.ports));

		expect(await must(repo, ['symbolic-ref', 'HEAD'])).toBe(`refs/heads/${PROPOSAL}-3`);
	});

	test('two proposals started from the same title get different names', async () => {
		const { repo } = await create();
		doneId(await startProposal(repo.ports));
		const first = (await readProposal(repo.ports))!.branch;
		doneId(await stopProposal(repo.ports));

		doneId(await startProposal(repo.ports));

		const second = (await readProposal(repo.ports))!.branch;
		expect(first).toBe(PROPOSAL);
		expect(second).toMatch(/^proposal\/fit-the-dose-model-[0-9a-f]{6}$/);
		expect(second).not.toBe(first);
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

	test('finish and stop return nothing-to-do through the engine when no proposal is current', async () => {
		const { repo, c } = await create();
		const engine = await createEngine(repo.ports);
		try {
			expect(await engine.finishProposal(c)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
			expect(await engine.stopProposal()).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
		} finally {
			engine.dispose();
		}
	});

	test('an unsent proposal counts ahead against the base upstream, and history, edit, and undo treat base-upstream checkpoints as shared', async () => {
		const { repo, a, b, c } = await create();
		doneId(await startProposal(repo.ports));

		expect(await sharedReference(repo.ports)).toBe(a);
		expect(await sharedReference(repo.ports, 'main')).toBe(a);
		const facts = await readRepoFacts(repo.ports);
		expect(facts).toMatchObject({ branch: PROPOSAL, upstream: 'origin/main', ahead: 2, behind: 0 });
		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => [checkpoint.id, checkpoint.shared])).toEqual([[c, false], [b, false], [a, true]]);
		expect(await editDescription(repo.ports, a, 'New title', '')).toEqual({ kind: 'unavailable', reason: 'shared-checkpoint' });
		const edit = doneId(await editDescription(repo.ports, b, 'Fit the dose model', 'Reworded.'));

		// Once the base upstream has the edited checkpoints, plain Undo of the edit is refused.
		await must(repo, ['push', '-q', 'origin', `refs/heads/${PROPOSAL}:refs/heads/main`]);
		expect((await checkShared(repo.ports)).kind).toBe('done');
		expect(await readProposal(repo.ports)).toMatchObject({ sent: false });
		expect(await undo(repo.ports, edit, [])).toEqual({ kind: 'unavailable', reason: 'shared-checkpoint' });
	});

	test('start right after a finish, before Get changes, is refused with get-changes-first', async () => {
		const { repo, c } = await sentProposal();
		await accept(repo, 'squash');
		expect((await checkShared(repo.ports)).kind).toBe('done');
		doneId(await finishProposal(repo.ports, c));
		await repo.write('notes.txt', 'later\n');
		await commitOnly(repo, 'Add notes', ['notes.txt']);
		const before = await state(repo);

		expect(await startProposal(repo.ports)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'get-changes-first' });

		expect(await state(repo)).toEqual(before);
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

/** `ports` whose first `times` git calls that point HEAD at `ref` fail. */
function failingHeadWrites(ports: EnginePorts, ref: string, times: number): EnginePorts {
	let failed = 0;
	return {
		...ports,
		git: async (args, options) => {
			if (args.includes('symbolic-ref') && args.at(-2) === 'HEAD' && args.at(-1) === ref && failed < times) {
				failed++;
				return { exitCode: 1, stdout: '', stderr: 'injected failure', timedOut: false };
			}
			return ports.git(args, options);
		},
	};
}

describe('an operation whose steps after the commit point fail', { timeout: 60_000 }, () => {
	test('a retry that fails too is completed by recovery before the engine call returns', async () => {
		const { repo } = await create();
		const before = await state(repo);
		const id = doneId(await startProposal(repo.ports));
		// The undo of start moves main back first (its commit point), then points HEAD at main.
		const engine = await createEngine(failingHeadWrites(repo.ports, 'refs/heads/main', 2));
		try {
			expect(await engine.undo(id, [])).toEqual({ kind: 'interrupted' });

			const after = await engine.getState();
			expect([after.recoveryNotice, after.interrupted, after.unusual]).toEqual(['completed', undefined, undefined]);
			expect(await state(repo)).toEqual(before);
			expect((await readRecords(repo.ports)).at(-1)?.status).toBe('complete');
		} finally {
			engine.dispose();
		}
	});

	test('when recovery fails too, the state names it, and the next call completes it first', async () => {
		const { repo, c } = await create();
		const before = await state(repo);
		const id = doneId(await startProposal(repo.ports));
		const engine = await createEngine(failingHeadWrites(repo.ports, 'refs/heads/main', 3));
		try {
			expect(await engine.undo(id, [])).toEqual({ kind: 'interrupted' });
			expect((await engine.getState()).unusual?.kind).toBe('unrecovered');

			doneId(await engine.editDescription(c, 'Add the residual plot', 'Reworded.'));

			expect((await engine.getState()).unusual).toBeUndefined();
			expect((await state(repo)).head).toBe(before.head);
			expect((await readRecords(repo.ports)).filter(record => record.status !== 'complete')).toEqual([]);
		} finally {
			engine.dispose();
		}
	});
});

describe('sending a proposal', { timeout: 60_000 }, () => {
	/** The commit the shared copy's `ref` names, or undefined. */
	const remoteRef = async (repo: TempRepo, ref: string) => {
		const line = await must(repo, ['ls-remote', 'origin', ref]);
		return line === '' ? undefined : line.split('\t')[0];
	};

	/** A started proposal with a Redo entry (an undone edit) and the start on the undo list. */
	const started = async () => {
		const project = await create();
		const { repo, b } = project;
		doneId(await startProposal(repo.ports));
		const edit = doneId(await editDescription(repo.ports, b, 'Fit the dose model', ''));
		doneId(await undo(repo.ports, edit, []));
		expect((await redoHead(repo.ports))?.id).toBe(edit);
		return project;
	};

	test('the first send of a proposal sets its upstream and clears undo and redo', async () => {
		const { repo, a, c } = await started();
		expect((await undoHead(repo.ports))?.kind).toBe('start-proposal');

		doneId(await sendChanges(repo.ports));

		expect(await remoteRef(repo, `refs/heads/${PROPOSAL}`)).toBe(c);
		expect(await remoteRef(repo, 'refs/heads/main')).toBe(a);
		expect(await must(repo, ['config', '--get', `branch.${PROPOSAL}.merge`])).toBe(`refs/heads/${PROPOSAL}`);
		expect(await readProposal(repo.ports)).toEqual({ branch: PROPOSAL, base: 'main', sent: true });
		expect(await readRepoFacts(repo.ports)).toMatchObject({ upstream: `origin/${PROPOSAL}`, ahead: 0, behind: 0 });
		expect(await undoHead(repo.ports)).toBeUndefined();
		expect(await redoHead(repo.ports)).toBeUndefined();
		expect((await readRecords(repo.ports)).at(-1)).toMatchObject({ kind: 'send-changes', status: 'complete' });
	});

	test('a later send goes to the proposal\'s upstream', async () => {
		const { repo, a } = await started();
		doneId(await sendChanges(repo.ports));
		await repo.write('b.txt', 'plot\nlegend\n');
		const d = await repo.commit('Add a legend');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ upstream: `origin/${PROPOSAL}`, ahead: 1 });

		doneId(await sendChanges(repo.ports));

		expect(await remoteRef(repo, `refs/heads/${PROPOSAL}`)).toBe(d);
		expect(await remoteRef(repo, 'refs/heads/main')).toBe(a);
	});

	test('Get changes on a sent proposal gets a colleague\'s commit from the proposal branch', async () => {
		const { repo } = await started();
		doneId(await sendChanges(repo.ports));
		const colleague = await repo.clone();
		repos.push(colleague);
		await must(colleague, ['checkout', '-q', '-b', PROPOSAL, `origin/${PROPOSAL}`]);
		await colleague.write('c.txt', 'from a colleague\n');
		await colleague.commit('A colleague\'s change');
		await must(colleague, ['push', '-q', 'origin', PROPOSAL]);

		expect((await checkShared(repo.ports)).kind).toBe('done');
		const preview = await previewIncoming(repo.ports);
		expect(preview.incoming.map(checkpoint => checkpoint.title)).toEqual(['A colleague\'s change']);
		doneId(await getIncoming(repo.ports, preview.basis, [], []));

		expect(await repo.read('c.txt')).toBe('from a colleague\n');
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ branch: PROPOSAL, upstream: `origin/${PROPOSAL}`, ahead: 0, behind: 0 });
	});

	test('with the remote branch deleted by the host and pruned by Check, state.proposal.sent is true and sendChanges returns proposal-ended', async () => {
		const { repo, a } = await started();
		doneId(await sendChanges(repo.ports));
		// The host deletes the branch; this computer learns of it only through its own fetch.
		const host = await colleagueOf(repo);
		await must(host, ['push', '-q', 'origin', '--delete', PROPOSAL]);
		expect(await refExists(repo, `refs/remotes/origin/${PROPOSAL}`)).toBe(true);
		expect((await checkShared(repo.ports)).kind).toBe('done');
		expect(await refExists(repo, `refs/remotes/origin/${PROPOSAL}`)).toBe(false);
		await repo.write('b.txt', 'plot\nlegend\n');
		await repo.commit('Add a legend');

		const engine = await createEngine(repo.ports);
		try {
			const result = await engine.getState();
			expect(result.proposal).toEqual({ branch: PROPOSAL, base: 'main', sent: true });
			expect(result.shared).toMatchObject({ exists: true, name: 'origin/main', ahead: 3 });
		} finally {
			engine.dispose();
		}
		expect(await sharedReference(repo.ports)).toBe(a);
		expect(await sendChanges(repo.ports)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'proposal-ended' });
		expect(await remoteRef(repo, `refs/heads/${PROPOSAL}`)).toBeUndefined();
	});

	test('a first send that the shared copy refuses changes nothing and keeps the undo list', async () => {
		const { repo } = await started();
		const ports = { ...repo.ports, network: { ...repo.ports.network, publish: async () => ({ ok: false as const, reason: 'review-required' as const, detail: 'refused' }) } };

		expect(await sendChanges(ports)).toEqual({ kind: 'rejected', reason: 'review-required', detail: 'refused' });

		expect(await readProposal(repo.ports)).toEqual({ branch: PROPOSAL, base: 'main', sent: false });
		expect((await undoHead(repo.ports))?.kind).toBe('start-proposal');
	});
});

/** A proposal started from `create(sameLines)` and sent, so the shared copy has its branch. */
async function sentProposal(sameLines = false) {
	const project = await create(sameLines);
	doneId(await startProposal(project.repo.ports));
	doneId(await sendChanges(project.repo.ports));
	return project;
}

/** A colleague's clone of the shared copy, on main. */
async function colleagueOf(repo: TempRepo): Promise<TempRepo> {
	const colleague = await repo.clone();
	repos.push(colleague);
	return colleague;
}

type Acceptance = 'merge' | 'squash' | 'rebase';

/** A colleague accepts the proposal into the shared copy's main, the way GitHub does with `how`. */
async function accept(repo: TempRepo, how: Acceptance): Promise<TempRepo> {
	const colleague = await colleagueOf(repo);
	const proposal = `origin/${PROPOSAL}`;
	if (how === 'merge') {
		await must(colleague, ['merge', '-q', '--no-ff', '-m', 'Merge the proposal', proposal]);
	} else if (how === 'squash') {
		await must(colleague, ['merge', '-q', '--squash', proposal]);
		await must(colleague, ['commit', '-q', '-m', 'Fit the dose model (#1)']);
	} else {
		await must(colleague, ['cherry-pick', `main..${proposal}`]);
	}
	await must(colleague, ['push', '-q', 'origin', 'main']);
	return colleague;
}

/** Fetches, finishes the proposal with `acceptedCommit`, and runs Get changes with the preview's basis. */
async function finishAndGet(repo: TempRepo, acceptedCommit: string) {
	expect((await checkShared(repo.ports)).kind).toBe('done');
	doneId(await finishProposal(repo.ports, acceptedCommit));
	const preview = await previewIncoming(repo.ports);
	return { preview, result: await getIncoming(repo.ports, preview.basis, [], []) };
}

/** Commits only what `paths` change, leaving the unrecorded edit and the untracked file alone. */
async function commitOnly(repo: TempRepo, message: string, paths: string[]): Promise<string> {
	await must(repo, ['add', '-A', '--', ...paths]);
	await must(repo, ['commit', '-q', '-m', message, '--', ...paths]);
	return must(repo, ['rev-parse', 'HEAD']);
}

describe('stopProposal', { timeout: 60_000 }, () => {
	test('stop returns the checkpoints to the base branch, files unchanged; undo restores the proposal with its whole configuration section', async () => {
		const { repo, c } = await sentProposal();
		const before = await state(repo);
		expect(before.config).toBe([
			`branch.${PROPOSAL}.positroncheckpointsbase main`, `branch.${PROPOSAL}.remote origin`, `branch.${PROPOSAL}.merge refs/heads/${PROPOSAL}`, '',
		].join('\n'));

		const id = doneId(await stopProposal(repo.ports));

		expect(await state(repo)).toEqual({ ...before, head: 'refs/heads/main', main: c, proposal: undefined, config: '' });
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect(await readProposal(repo.ports)).toBeUndefined();
		expect(await readRepoFacts(repo.ports)).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 0 });
		expect((await readRecords(repo.ports)).at(-1)).toMatchObject({ kind: 'stop-proposal', status: 'complete', commitPoint: 0 });
		expect((await undoHead(repo.ports))?.id).toBe(id);

		doneId(await undo(repo.ports, id, []));
		expect(await state(repo)).toEqual(before);
		expect(await readProposal(repo.ports)).toEqual({ branch: PROPOSAL, base: 'main', sent: true });

		doneId(await redo(repo.ports, id, []));
		expect(await state(repo)).toEqual({ ...before, head: 'refs/heads/main', main: c, proposal: undefined, config: '' });
	});

	test('a commit made on the base branch with git while the proposal is open survives a refused stop and a refused finish', async () => {
		const { repo, a, c } = await sentProposal();
		// The person switches to main with another tool, commits a fix there, and switches back.
		const fix = await must(repo, ['commit-tree', `${a}^{tree}`, '-p', a, '-m', 'A fix on main']);
		await must(repo, ['update-ref', 'refs/heads/main', fix]);
		const before = await state(repo);
		const refused = { kind: 'unavailable', reason: 'unusual-state', detail: 'base-moved' };

		expect(await stopProposal(repo.ports)).toEqual(refused);
		expect(await finishProposal(repo.ports, c)).toEqual(refused);

		expect(await state(repo)).toEqual(before);
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(fix);
	});

	test('a base that a pull moved forward along the shared copy does not refuse stop', async () => {
		const { repo, c } = await sentProposal();
		const colleague = await colleagueOf(repo);
		await colleague.write('other.txt', 'from a colleague\n');
		await colleague.commit('A colleague\'s change');
		await repo.pushFrom(colleague);
		expect((await checkShared(repo.ports)).kind).toBe('done');
		await must(repo, ['update-ref', 'refs/heads/main', 'refs/remotes/origin/main']);

		doneId(await stopProposal(repo.ports));
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(c);
	});

	test('a commit on the base after a crash past HEAD\'s move is kept, and recovery completes the stop', async () => {
		const reference = await sentProposal();
		const calls = faultPorts(reference.repo.ports, {});
		doneId(await stopProposal(calls));
		const removal = calls.mutatingCalls.indexOf(`update-ref refs/heads/${PROPOSAL}`) + 1;
		expect(removal).toBeGreaterThan(0);

		const { repo, c } = await sentProposal();
		await stopProposal(faultPorts(repo.ports, { stopAt: removal })).catch(() => undefined);
		await fsp.rm(`${await engineDirectory(repo.ports)}/lock`, { force: true });
		// HEAD is on main at the tip; the person commits there with git.
		expect(await must(repo, ['symbolic-ref', 'HEAD'])).toBe('refs/heads/main');
		const fix = await must(repo, ['commit-tree', `${c}^{tree}`, '-p', c, '-m', 'A fix on main']);
		await must(repo, ['update-ref', 'refs/heads/main', fix]);

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'completed' });

		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(fix);
		expect(await refExists(repo, `refs/heads/${PROPOSAL}`)).toBe(false);
		expect((await state(repo)).config).toBe('');
		expect((await readRecords(repo.ports)).at(-1)?.status).toBe('complete');
	});

	test('stop and finish are refused with get-changes-first when the proposal is behind its own upstream', async () => {
		const { repo, c } = await sentProposal();
		const colleague = await colleagueOf(repo);
		await must(colleague, ['checkout', '-q', '-b', PROPOSAL, `origin/${PROPOSAL}`]);
		await colleague.write('c.txt', 'from a colleague\n');
		await colleague.commit('A colleague\'s change');
		await must(colleague, ['push', '-q', 'origin', PROPOSAL]);
		expect((await checkShared(repo.ports)).kind).toBe('done');
		const before = await state(repo);
		const refused = { kind: 'unavailable', reason: 'nothing-to-do', detail: 'get-changes-first' };

		expect(await stopProposal(repo.ports)).toEqual(refused);
		expect(await finishProposal(repo.ports, c)).toEqual(refused);

		expect(await state(repo)).toEqual(before);
		expect((await readRecords(repo.ports)).at(-1)?.kind).toBe('send-changes');
	});
});

describe('finishProposal', { timeout: 120_000 }, () => {
	test.each<Acceptance>(['merge', 'squash', 'rebase'])('finish then Get changes after a %s acceptance: files equal the shared copy plus the unrecorded changes, and nothing is ahead', async how => {
		const { repo, c } = await sentProposal();
		await accept(repo, how);

		const { result } = await finishAndGet(repo, c);

		doneId(result);
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect(await repo.read('b.txt')).toBe('plot\n');
		expect(await repo.read('u.txt')).toBe('untracked\n');
		expect(await must(repo, ['rev-parse', 'HEAD^{tree}'])).toBe(await must(repo, ['rev-parse', 'refs/remotes/origin/main^{tree}']));
		expect(await readRepoFacts(repo.ports)).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
		expect(await refExists(repo, `refs/heads/${PROPOSAL}`)).toBe(false);
		expect(await acceptedThrough(repo.ports)).toBeUndefined();
	});

	test('finish then Get changes after a squash acceptance while a colleague added an unrelated checkpoint to the shared copy', async () => {
		const { repo, c } = await sentProposal();
		const colleague = await colleagueOf(repo);
		await colleague.write('other.txt', 'from a colleague\n');
		await colleague.commit('A colleague\'s change');
		await repo.pushFrom(colleague);
		await must(colleague, ['fetch', '-q', 'origin']);
		await must(colleague, ['merge', '-q', '--squash', `origin/${PROPOSAL}`]);
		await must(colleague, ['commit', '-q', '-m', 'Fit the dose model (#1)']);
		await must(colleague, ['push', '-q', 'origin', 'main']);
		expect((await checkShared(repo.ports)).kind).toBe('done');

		doneId(await finishProposal(repo.ports, c));
		expect(await acceptedThrough(repo.ports)).toBe(c);
		const preview = await previewIncoming(repo.ports);
		expect(preview.overlaps).toEqual([]);
		doneId(await getIncoming(repo.ports, preview.basis, [], []));

		expect(await repo.read('other.txt')).toBe('from a colleague\n');
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ ahead: 0, behind: 0 });
	});

	test('undo of the Get changes after a finish keeps the accepted record, and Get changes again gives no overlap', async () => {
		const { repo, c } = await sentProposal(true);
		await accept(repo, 'squash');
		const { result } = await finishAndGet(repo, c);
		const get = doneId(result);
		expect(JSON.parse((await acceptedFile(repo))!)).toEqual({ main: c });
		expect(await acceptedThrough(repo.ports)).toBeUndefined();

		doneId(await undo(repo.ports, get, []));
		expect(await acceptedThrough(repo.ports)).toBe(c);
		expect(await readRepoFacts(repo.ports)).toMatchObject({ ahead: 0, behind: 1 });

		const again = await previewIncoming(repo.ports);
		expect(again.overlaps).toEqual([]);
		doneId(await getIncoming(repo.ports, again.basis, [], []));
		expect(await repo.read('a.txt')).toBe('three\nunrecorded\n');
	});

	test('a Get changes on another branch leaves the accepted record of the base', async () => {
		const { repo, c } = await sentProposal();
		await must(repo, ['push', '-q', 'origin', `${c}:refs/heads/other`]);
		const colleague = await accept(repo, 'squash');
		await must(colleague, ['checkout', '-q', '-b', 'other', 'origin/other']);
		await colleague.write('other.txt', 'on the other line\n');
		await colleague.commit('Work on the other line');
		await must(colleague, ['push', '-q', 'origin', 'other']);
		expect((await checkShared(repo.ports)).kind).toBe('done');
		doneId(await finishProposal(repo.ports, c));
		await must(repo, ['branch', '-q', '--track', 'other', 'origin/other']);
		await must(repo, ['update-ref', 'refs/heads/other', c]);
		await must(repo, ['symbolic-ref', 'HEAD', 'refs/heads/other']);

		const preview = await previewIncoming(repo.ports);
		doneId(await getIncoming(repo.ports, preview.basis, [], []));

		expect(await repo.read('other.txt')).toBe('on the other line\n');
		expect(JSON.parse((await acceptedFile(repo))!)).toEqual({ main: c });
		expect(await acceptedThrough(repo.ports, 'main')).toBe(c);
	});

	test('finish then Get changes after a squash of two checkpoints that changed the same lines gives no overlap', async () => {
		const { repo, c } = await sentProposal(true);
		await accept(repo, 'squash');

		const { preview, result } = await finishAndGet(repo, c);

		expect(preview.overlaps).toEqual([]);
		doneId(result);
		expect(await repo.read('a.txt')).toBe('three\nunrecorded\n');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ ahead: 0, behind: 0 });
	});

	test('with the host\'s accepted commit, a checkpoint after it that reverses an accepted one is replayed, and the file has the reversed content', async () => {
		const { repo, c } = await sentProposal();
		await accept(repo, 'squash');
		await fsp.rm(`${repo.root}/b.txt`);
		await commitOnly(repo, 'Remove the residual plot', ['b.txt']);

		const { result } = await finishAndGet(repo, c);

		doneId(result);
		expect(await fsp.access(`${repo.root}/b.txt`).then(() => true, () => false)).toBe(false);
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ ahead: 1, behind: 0 });
	});

	test('the contract of acceptedCommit: passing the proposal\'s tip in place of the host\'s value hides a later reversal', async () => {
		const { repo } = await sentProposal();
		await accept(repo, 'squash');
		await fsp.rm(`${repo.root}/b.txt`);
		const tip = await commitOnly(repo, 'Remove the residual plot', ['b.txt']);

		const { result } = await finishAndGet(repo, tip);

		// The engine cannot tell this from a real acceptance; only the caller's contract prevents it.
		doneId(result);
		expect(await repo.read('b.txt')).toBe('plot\n');
	});

	test('finish with an acceptedCommit that is unknown locally writes no record; Get changes drops the checkpoints the shared copy has', async () => {
		const { repo } = await sentProposal();
		await accept(repo, 'squash');

		const { result } = await finishAndGet(repo, '0123456789abcdef0123456789abcdef01234567');

		doneId(result);
		expect((await readRecords(repo.ports)).find(record => record.kind === 'finish-proposal')?.refChanges?.some(change => change.type === 'engine-file')).toBe(false);
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect(await repo.read('b.txt')).toBe('plot\n');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ ahead: 0, behind: 0 });
	});

	test('finish when a colleague changed the same lines after acceptance writes no record; Get changes returns overlaps', async () => {
		const { repo, c } = await sentProposal();
		const colleague = await accept(repo, 'squash');
		await colleague.write('a.txt', 'TWO\n');
		await colleague.commit('Shout the second line');
		await repo.pushFrom(colleague);
		expect((await checkShared(repo.ports)).kind).toBe('done');

		doneId(await finishProposal(repo.ports, c));
		expect(await acceptedFile(repo)).toBeUndefined();
		expect(await acceptedThrough(repo.ports)).toBeUndefined();
		const preview = await previewIncoming(repo.ports);
		const result = await getIncoming(repo.ports, preview.basis, [], []);

		expect(result.kind).toBe('overlaps');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ branch: 'main', ahead: 2 });
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
	});

	test('checkpoints made after acceptance stay ahead after Get changes', async () => {
		const { repo, c } = await sentProposal();
		await accept(repo, 'squash');
		await repo.write('notes.txt', 'later\n');
		const d = await commitOnly(repo, 'Add notes', ['notes.txt']);

		const { result } = await finishAndGet(repo, c);

		doneId(result);
		expect(await repo.read('notes.txt')).toBe('later\n');
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect(await readRepoFacts(repo.ports)).toMatchObject({ ahead: 1, behind: 0 });
		expect((await getHistory(repo.ports, 0, 1))[0]).toMatchObject({ title: 'Add notes', shared: false });
		expect(await must(repo, ['rev-parse', 'HEAD'])).not.toBe(d);
	});

	test('the record is left out of ahead, shared, and the basis, is ignored after Get changes, and is removed by undo of finish', async () => {
		const { repo, b, c } = await sentProposal();
		await accept(repo, 'squash');
		expect((await checkShared(repo.ports)).kind).toBe('done');

		const id = doneId(await finishProposal(repo.ports, c));

		expect(JSON.parse((await acceptedFile(repo))!)).toEqual({ main: c });
		expect(await acceptedThrough(repo.ports)).toBe(c);
		expect(await readRepoFacts(repo.ports)).toMatchObject({ branch: 'main', ahead: 0, behind: 1 });
		expect((await getHistory(repo.ports, 0, 2)).map(checkpoint => [checkpoint.id, checkpoint.shared])).toEqual([[c, true], [b, true]]);
		expect(await editDescription(repo.ports, c, 'New title', '')).toEqual({ kind: 'unavailable', reason: 'shared-checkpoint' });

		// The basis is bound to the record: without it the replay differs.
		const preview = await previewIncoming(repo.ports);
		const saved = await acceptedFile(repo);
		await fsp.rm(`${await engineDirectory(repo.ports)}/accepted.json`);
		expect(await getIncoming(repo.ports, preview.basis, [], [])).toMatchObject({ kind: 'inputs-changed', changed: ['shared'] });
		await fsp.writeFile(`${await engineDirectory(repo.ports)}/accepted.json`, saved!);

		// Undo of finish removes the record and restores the proposal.
		const finished = await state(repo);
		doneId(await undo(repo.ports, id, []));
		expect(await acceptedFile(repo)).toBeUndefined();
		expect(await readProposal(repo.ports)).toEqual({ branch: PROPOSAL, base: 'main', sent: true });
		doneId(await redo(repo.ports, id, []));
		expect(await state(repo)).toEqual(finished);

		const again = await previewIncoming(repo.ports);
		doneId(await getIncoming(repo.ports, again.basis, [], []));
		expect(await acceptedThrough(repo.ports)).toBeUndefined();
		expect(await readRepoFacts(repo.ports)).toMatchObject({ ahead: 0, behind: 0 });
	});

	test('the record is ignored, and kept, while its checkpoint is not in the branch', async () => {
		const { repo, a, c } = await sentProposal();
		await accept(repo, 'squash');
		expect((await checkShared(repo.ports)).kind).toBe('done');
		doneId(await finishProposal(repo.ports, c));
		expect(await acceptedThrough(repo.ports)).toBe(c);

		await must(repo, ['update-ref', 'refs/heads/main', a]);

		expect(await acceptedThrough(repo.ports)).toBeUndefined();
		expect(JSON.parse((await acceptedFile(repo))!)).toEqual({ main: c });
		expect((await readRepoFacts(repo.ports)).ahead).toBe(0);

		await must(repo, ['update-ref', 'refs/heads/main', c]);
		expect(await acceptedThrough(repo.ports)).toBe(c);
	});
});

describe('finish and stop under faults', { timeout: 180_000 }, () => {
	/** A sent proposal that the shared copy took as it is (its main now names the proposal's tip), fetched. */
	const acceptedAsIs = async () => {
		const project = await sentProposal();
		await must(project.repo, ['push', '-q', 'origin', `refs/heads/${PROPOSAL}:refs/heads/main`]);
		expect((await checkShared(project.repo.ports)).kind).toBe('done');
		return project;
	};

	const run = (kind: 'finish' | 'stop', ports: EnginePorts, c: string) => kind === 'finish' ? finishProposal(ports, c) : stopProposal(ports);

	/** The state a completed finish or stop leaves. */
	const afterState = (kind: 'finish' | 'stop', before: Awaited<ReturnType<typeof state>>, c: string) => ({
		...before, head: 'refs/heads/main', main: c, proposal: undefined, config: '',
		accepted: kind === 'finish' ? `${JSON.stringify({ main: c })}\n` : undefined,
	});

	test.each(['finish', 'stop'] as const)('%s: a base that another tool moves during the operation refuses the compare-and-swap, and nothing changes', async kind => {
		const { repo, b, c } = await acceptedAsIs();
		const before = await state(repo);
		// Another tool moves main after the operation checked it and recorded its intent.
		const ports = afterJournal(repo.ports, async () => {
			await must(repo, ['update-ref', 'refs/heads/main', b]);
		});

		const result = await run(kind, ports, c);

		expect(result.kind).toBe('could-not-finish');
		expect(await state(repo)).toEqual({ ...before, main: b });
		expect((await readRecords(repo.ports)).at(-1)?.status).toBe('rolled-back');
	});

	test.each(['finish', 'stop'] as const)('%s: a fault at each step after the commit point is completed to the exact after state', async kind => {
		const reference = await acceptedAsIs();
		const ports = faultPorts(reference.repo.ports, {});
		doneId(await run(kind, ports, reference.c));
		const calls = ports.mutatingCalls;
		const commitPoint = calls.indexOf('update-ref refs/heads/main') + 1;
		expect(commitPoint).toBeGreaterThan(0);
		// The mutating calls of the ref changes after the commit point, in order.
		const later = /^(symbolic-ref HEAD|write .*\/accepted\.json|update-ref refs\/heads\/proposal\/|config branch\.proposal\/)/;
		const steps = calls.map((_call, index) => index + 1).filter(number => number > commitPoint && later.test(calls[number - 1]));
		expect(steps.length).toBe(kind === 'finish' ? 4 : 3);

		for (const step of steps) {
			const failing = await acceptedAsIs();
			const before = await state(failing.repo);
			expect(await run(kind, faultPorts(failing.repo.ports, { failAt: step }), failing.c), `fault at ${calls[step - 1]}`).toMatchObject({ kind: 'done' });
			expect(await state(failing.repo)).toEqual(afterState(kind, before, failing.c));

			const crashing = await acceptedAsIs();
			const crashedBefore = await state(crashing.repo);
			await run(kind, faultPorts(crashing.repo.ports, { stopAt: step }), crashing.c).catch(() => undefined);
			expect((await readRecords(crashing.repo.ports)).at(-1)?.status, `crash at ${calls[step - 1]}`).toBe('prepared');
			await fsp.rm(`${await engineDirectory(crashing.repo.ports)}/lock`, { force: true });
			expect(await recoverOnStart(crashing.repo.ports)).toEqual({ notice: 'completed' });
			expect(await state(crashing.repo)).toEqual(afterState(kind, crashedBefore, crashing.c));
		}
	});
});
