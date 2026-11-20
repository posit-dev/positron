/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IEngineState, OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { IGitHubClient, parseProjectLink, ProposalInfo } from '../../browser/github/githubClient.js';
import { AskStep, ProposalController } from '../../browser/proposalController.js';
import { ISyncController } from '../../browser/syncController.js';
import { FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

const GITHUB_URL = 'https://github.com/me/dose-model.git';
const BRANCH = 'proposal/fit-the-dose-model';

/** A project on GitHub with 2 unshared checkpoints, or with the given proposal. */
function projectState(proposal?: IEngineState['proposal'], overrides: Partial<IEngineState> = {}): IEngineState {
	return fakeEngineState({ shared: { exists: true, ahead: 2, behind: 0 }, sharedUrl: GITHUB_URL, proposal, branch: proposal?.branch ?? 'main', ...overrides });
}

function info(overrides: Partial<ProposalInfo> = {}): ProposalInfo {
	return { number: 7, url: 'https://github.com/me/dose-model/pull/7', state: 'waiting', overlapsShared: false, headCommit: 'abc123', ...overrides };
}

describe('ProposalController', () => {
	const github = {
		openProposal: vi.fn<IGitHubClient['openProposal']>(),
		findProposal: vi.fn<IGitHubClient['findProposal']>(),
		closeProposal: vi.fn<IGitHubClient['closeProposal']>(),
	};
	const sync = { refreshPreview: vi.fn(async () => { }), getChanges: vi.fn(async (): Promise<OperationResult | undefined> => undefined) };

	const ctx = createTestContainer()
		.stub(IGitHubClient, { ...github, parseProjectLink })
		.stub(ISyncController, sync)
		.stub(IContextKeyService, new MockContextKeyService())
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.build();

	let engine: FakeCheckpointsEngine;
	let messageService: CheckpointsMessageService;

	beforeEach(() => {
		vi.clearAllMocks();
		github.openProposal.mockResolvedValue({ ok: true, url: 'https://github.com/me/dose-model/pull/7', number: 7 });
		github.findProposal.mockResolvedValue({ ok: true, proposal: info() });
		github.closeProposal.mockResolvedValue({ ok: true });
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		engine.state = projectState();
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		messageService = ctx.disposables.add(new CheckpointsMessageService());
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, messageService);
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	/** Creates the controller and waits for its first read of the state. */
	async function createController(): Promise<ProposalController> {
		const controller = ctx.disposables.add(ctx.instantiationService.createInstance(ProposalController));
		await vi.waitFor(() => expect(engine.callsOf('getState').length).toBeGreaterThan(0));
		await controller.refresh();
		return controller;
	}

	/** Makes the fake engine change its state as the real engine does after start and send. */
	function followOperations(): void {
		engine.afterOperation = (method, result) => {
			if (result.kind !== 'done') {
				return;
			}
			if (method === 'startProposal') {
				engine.state = projectState({ branch: BRANCH, base: 'main', sent: false });
			} else if (method === 'sendChanges' && engine.state.proposal) {
				engine.state = projectState({ ...engine.state.proposal, sent: true }, { shared: { exists: true, ahead: 0, behind: 0 } });
			} else if (method === 'stopProposal' || method === 'finishProposal') {
				engine.state = projectState();
			}
		};
	}

	/** The engine operations and GitHub calls, in order. */
	function operations(): string[] {
		return engine.calls.map(call => call.method).filter(method => method !== 'getState');
	}

	test('ask runs start, send, open in order and reports each step', async () => {
		followOperations();
		github.findProposal.mockResolvedValue({ ok: true });
		const controller = await createController();
		const steps: AskStep[] = [];

		const result = await controller.ask('Fit the dose model', '- Fit the dose model', step => steps.push(step));

		expect({ result, steps, operations: operations(), open: github.openProposal.mock.calls }).toEqual({
			result: { ok: true },
			steps: ['starting', 'sending', 'asking'],
			operations: ['startProposal', 'sendChanges'],
			open: [['me', 'dose-model', BRANCH, 'main', 'Fit the dose model', '- Fit the dose model']],
		});
	});

	test('ask after a failed open runs only open, and makes no second startProposal', async () => {
		followOperations();
		github.findProposal.mockResolvedValue({ ok: true });
		github.openProposal.mockResolvedValueOnce({ ok: false, reason: 'offline', detail: 'fetch failed' });
		const controller = await createController();

		const first = await controller.ask('Fit the dose model', 'body', () => { });
		expect(first).toEqual({
			ok: false,
			failedStep: 'asking',
			message: 'Your checkpoints were sent, but the review could not be asked for. GitHub could not be reached. Check your connection and try again.',
		});
		expect(controller.state).toEqual({ kind: 'not-asked' });

		const steps: AskStep[] = [];
		const second = await controller.ask('Fit the dose model', 'body', step => steps.push(step));

		expect({ second, steps, operations: operations(), opens: github.openProposal.mock.calls.length }).toEqual({
			second: { ok: true },
			steps: ['asking'],
			operations: ['startProposal', 'sendChanges'],
			opens: 2,
		});
	});

	test('a failed send leaves the proposal and says what was done', async () => {
		followOperations();
		engine.queuedResults = [{ kind: 'done', operationId: 'op-start', hookEditedFiles: [] }, { kind: 'rejected', reason: 'offline', detail: 'no route' }];
		const controller = await createController();

		const result = await controller.ask('Fit the dose model', 'body', () => { });

		expect(result).toEqual({
			ok: false,
			failedStep: 'sending',
			message: 'Your proposal is ready on this computer, but your checkpoints could not be sent. The shared copy could not be reached. Check your connection and try again.',
		});
		expect(controller.state).toEqual({ kind: 'not-sent' });
		expect(github.openProposal).not.toHaveBeenCalled();
	});

	test('already-open is success', async () => {
		followOperations();
		github.findProposal.mockResolvedValueOnce({ ok: true });
		github.openProposal.mockResolvedValue({ ok: false, reason: 'already-open', detail: 'A pull request already exists' });
		const controller = await createController();

		await expect(controller.ask('Fit the dose model', 'body', () => { })).resolves.toEqual({ ok: true });
		expect(controller.state).toEqual({ kind: 'known', info: info() });
	});

	test('refresh makes no GitHub call without a proposal, or for a proposal not sent', async () => {
		const controller = await createController();
		engine.state = projectState({ branch: BRANCH, base: 'main', sent: false });
		await controller.refresh();

		expect(github.findProposal).not.toHaveBeenCalled();
		expect(controller.state).toEqual({ kind: 'not-sent' });
	});

	test('a sent proposal reads its state from GitHub by the branch name', async () => {
		engine.state = projectState({ branch: BRANCH, base: 'main', sent: true });
		github.findProposal.mockResolvedValue({ ok: false, reason: 'sign-in-required', detail: '401' });
		const controller = await createController();

		expect(github.findProposal).toHaveBeenCalledWith('me', 'dose-model', BRANCH);
		expect(controller.state).toEqual({ kind: 'unreadable', reason: 'sign-in-required' });
	});

	test('finish passes headCommit and then starts Get changes', async () => {
		followOperations();
		engine.state = projectState({ branch: BRANCH, base: 'main', sent: true });
		github.findProposal.mockResolvedValue({ ok: true, proposal: info({ state: 'accepted', headCommit: 'def456' }) });
		const controller = await createController();

		await controller.finish();

		expect(operations()).toEqual(['checkShared', 'finishProposal']);
		expect(engine.callsOf('finishProposal')).toEqual([['def456']]);
		expect(sync.getChanges).toHaveBeenCalledTimes(1);
	});

	test('finish with get-changes-first starts nothing and says why', async () => {
		engine.state = projectState({ branch: BRANCH, base: 'main', sent: true });
		github.findProposal.mockResolvedValue({ ok: true, proposal: info({ state: 'accepted' }) });
		engine.queuedResults = [{ kind: 'done', operationId: 'op-check', hookEditedFiles: [] }, { kind: 'unavailable', reason: 'nothing-to-do', detail: 'get-changes-first' }];
		const controller = await createController();

		await controller.finish();

		expect(sync.getChanges).not.toHaveBeenCalled();
		expect(messageService.message).toBe('A colleague added changes to your proposal. Get changes, then finish.');
	});

	test('stop closes the pull request only when one is open', async () => {
		followOperations();
		engine.state = projectState({ branch: BRANCH, base: 'main', sent: true });
		github.findProposal.mockResolvedValue({ ok: true, proposal: info({ state: 'closed' }) });
		const closedController = await createController();

		await expect(closedController.stop()).resolves.toEqual({ engine: engine.nextResult, closedOnGitHub: false });
		expect(github.closeProposal).not.toHaveBeenCalled();

		engine.state = projectState({ branch: BRANCH, base: 'main', sent: true });
		github.findProposal.mockResolvedValue({ ok: true, proposal: info({ state: 'waiting' }) });
		const openController = await createController();

		await expect(openController.stop()).resolves.toEqual({ engine: engine.nextResult, closedOnGitHub: true });
		expect(github.closeProposal).toHaveBeenCalledWith('me', 'dose-model', 7);
	});

	test('a failed close is reported, with the link to the proposal', async () => {
		followOperations();
		engine.state = projectState({ branch: BRANCH, base: 'main', sent: true });
		github.closeProposal.mockResolvedValue({ ok: false, reason: 'offline', detail: 'fetch failed' });
		const controller = await createController();

		const result = await controller.stop();

		expect(result.closedOnGitHub).toBe(false);
		expect(controller.state).toEqual({ kind: 'not-closed', url: 'https://github.com/me/dose-model/pull/7' });
		expect(messageService.message).toBe('Your proposal was stopped on this computer, but Positron could not close it on GitHub.');
	});

	test('a Send refused for review sets reviewRequired on GitHub and not on another host', async () => {
		engine.nextResult = { kind: 'rejected', reason: 'review-required', detail: 'GH006' };
		const controller = await createController();
		await controller.send();
		expect(controller.reviewRequired).toBe(true);

		engine.state = projectState(undefined, { sharedUrl: 'https://gitlab.com/me/dose-model.git' });
		const otherHost = await createController();
		await otherHost.send();
		expect(otherHost.reviewRequired).toBe(false);
	});
});
