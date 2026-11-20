/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IEngineState } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { FindProposalResult, IGitHubClient, ProposalInfo } from '../../browser/github/githubClient.js';
import { IProposalController } from '../../browser/proposalController.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { FORBIDDEN_WORDS } from '../../common/forbiddenWords.js';
import { fakeCheckpoint, FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';
import { createProposalController, fakeProposalGitHub } from './proposalTestHelpers.js';

const GITHUB_URL = 'https://github.com/me/dose-model.git';
const PULL_URL = 'https://github.com/me/dose-model/pull/7';
const BRANCH = 'proposal/fit-the-dose-model-3fa29c';

function info(overrides: Partial<ProposalInfo> = {}): ProposalInfo {
	return { number: 7, url: PULL_URL, state: 'waiting', overlapsShared: false, headCommit: 'abc123', ...overrides };
}

function proposalState(sent: boolean, overrides: Partial<IEngineState> = {}): IEngineState {
	return fakeEngineState({
		branch: BRANCH, sharedUrl: GITHUB_URL, proposal: { branch: BRANCH, base: 'main', sent },
		shared: { exists: true, ahead: sent ? 0 : 2, behind: 0 }, ...overrides,
	});
}

describe('ProposalCard', () => {
	const open = vi.fn(async () => true);
	const confirm = vi.fn(async () => ({ confirmed: true }));
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IOpenerService, { open })
		.stub(IDialogService, { confirm })
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let checkpointsService: CheckpointsService;
	let github: IGitHubClient;
	let findResult: FindProposalResult;

	beforeEach(() => {
		vi.clearAllMocks();
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		findResult = { ok: true, proposal: info() };
		github = fakeProposalGitHub({ findProposal: vi.fn(async () => findResult), closeProposal: vi.fn(async () => ({ ok: true as const })) });
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const cancel = screen.queryByRole('button', { name: 'Cancel' });
		if (cancel) {
			await userEvent.click(cancel);
		}
	});

	/** Registers the engine, makes the controller, and renders the panel. */
	function renderPanel(state: IEngineState) {
		engine.state = state;
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables, github));
		rtl.render(<CheckpointsPanel />);
	}

	/** The sentences and button labels of the card. */
	async function card(): Promise<{ text: string[]; buttons: string[] }> {
		const region = await screen.findByRole('region', { name: 'Your proposal' });
		return {
			text: within(region).getAllByRole('paragraph').map(paragraph => paragraph.textContent ?? ''),
			buttons: within(region).queryAllByRole('button').map(button => button.textContent ?? ''),
		};
	}

	test.each([
		['waiting', 'Waiting for a colleague to review your proposal.', ['Open on GitHub', 'Stop This Proposal']],
		['changes-requested', 'A colleague asked for changes. Read their comments on GitHub, create checkpoints for your changes, then send them.', ['Open on GitHub', 'Stop This Proposal']],
		['approved', 'A colleague approved your proposal. It joins the shared copy when it is accepted on GitHub.', ['Open on GitHub']],
		['accepted', 'Your proposal joined the shared copy.', ['Finish']],
		['closed', 'Your proposal was closed without joining the shared copy. Your checkpoints are still here.', ['Stop This Proposal', 'Open on GitHub']],
	] as const)('%s shows its sentence and buttons', async (state, sentence, buttons) => {
		findResult = { ok: true, proposal: info({ state }) };
		renderPanel(proposalState(true));

		await vi.waitFor(async () => expect(await card()).toEqual({ text: [sentence], buttons }));
	});

	test('a proposal not sent shows its sentence and buttons, and asks GitHub nothing', async () => {
		renderPanel(proposalState(false));

		await vi.waitFor(async () => expect(await card()).toEqual({ text: ['Your proposal is on this computer only.'], buttons: ['Ask for a Review', 'Stop This Proposal'] }));
		expect(github.findProposal).not.toHaveBeenCalled();
	});

	test('a sent proposal with no pull request offers to ask again', async () => {
		findResult = { ok: true };
		renderPanel(proposalState(true));

		await vi.waitFor(async () => expect(await card()).toEqual({ text: ['Your checkpoints were sent, but the review was not asked for.'], buttons: ['Ask for a Review', 'Stop This Proposal'] }));
	});

	test.each([
		['sign-in-required', 'Sign in to GitHub'],
		['offline', 'Check Again'],
	] as const)('a lookup that fails with %s offers %s and Stop', async (reason, button) => {
		findResult = { ok: false, reason, detail: '' };
		renderPanel(proposalState(true));

		await vi.waitFor(async () => expect(await card()).toEqual({
			text: ['Positron could not read the state of your proposal.', 'If you asked for a review, it may still be open on GitHub.'],
			buttons: [button, 'Stop This Proposal'],
		}));
	});

	test('while GitHub has not answered, the card says the state is being checked', async () => {
		github = fakeProposalGitHub({ findProposal: () => new Promise(() => { }) });
		renderPanel(proposalState(true));

		await vi.waitFor(async () => expect(await card()).toEqual({ text: ['Checking the state of your proposal...'], buttons: [] }));
	});

	test('an accepted proposal offers Finish and no Get Changes', async () => {
		findResult = { ok: true, proposal: info({ state: 'accepted' }) };
		renderPanel(proposalState(true, { shared: { exists: true, ahead: 0, behind: 2 } }));

		expect(await screen.findByRole('button', { name: 'Finish' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Get Changes' })).not.toBeInTheDocument();
	});

	test('opening the view with a proposal reads its state on GitHub again', async () => {
		engine.state = proposalState(true);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		const controller = createProposalController(ctx.instantiationService, ctx.disposables, github);
		ctx.instantiationService.stub(IProposalController, controller);
		await controller.refresh();
		const lookups = vi.mocked(github.findProposal).mock.calls.length;

		rtl.render(<CheckpointsPanel />);

		await vi.waitFor(() => expect(vi.mocked(github.findProposal).mock.calls.length).toBe(lookups + 1));
	});

	test('overlapsShared adds its sentence', async () => {
		findResult = { ok: true, proposal: info({ overlapsShared: true }) };
		renderPanel(proposalState(true));

		await vi.waitFor(async () => expect((await card()).text).toEqual([
			'Waiting for a colleague to review your proposal.',
			'Your proposal and the shared copy changed the same places. Open it on GitHub to choose what to keep.',
		]));
	});

	test('Open on GitHub opens the pull request', async () => {
		const user = userEvent.setup();
		renderPanel(proposalState(true));

		await user.click(await screen.findByRole('button', { name: 'Open on GitHub' }));

		expect(open).toHaveBeenCalledWith(URI.parse(PULL_URL), { openExternal: true });
	});

	test('Stop asks first, then stops and closes the pull request', async () => {
		const user = userEvent.setup();
		renderPanel(proposalState(true));

		await user.click(await screen.findByRole('button', { name: 'Stop This Proposal' }));

		expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Your checkpoints stay on this computer and are no longer in review.', primaryButton: 'Stop This Proposal' }));
		await vi.waitFor(() => expect(github.closeProposal).toHaveBeenCalledWith('me', 'dose-model', 7));
		expect(engine.callsOf('stopProposal')).toEqual([[]]);
	});

	test('Stop does nothing when the person cancels', async () => {
		const user = userEvent.setup();
		confirm.mockResolvedValueOnce({ confirmed: false });
		renderPanel(proposalState(true));

		await user.click(await screen.findByRole('button', { name: 'Stop This Proposal' }));

		expect(engine.callsOf('stopProposal')).toEqual([]);
	});

	test('Finish gives the engine the accepted commit', async () => {
		const user = userEvent.setup();
		findResult = { ok: true, proposal: info({ state: 'accepted', headCommit: 'def456' }) };
		renderPanel(proposalState(true));

		await user.click(await screen.findByRole('button', { name: 'Finish' }));

		await vi.waitFor(() => expect(engine.callsOf('finishProposal')).toEqual([['def456']]));
	});

	test('while a proposal has unsent checkpoints, Send is Send More Changes and the header counts them', async () => {
		engine.history = [fakeCheckpoint({ id: 'c2', shared: false }), fakeCheckpoint()];
		renderPanel(proposalState(true, { shared: { exists: true, ahead: 1, behind: 0 } }));

		expect(await screen.findByRole('button', { name: 'Send More Changes' })).toBeEnabled();
		expect(screen.getByText('1 checkpoint not in your proposal yet')).toBeInTheDocument();
	});

	test.each(['accepted', 'closed'] as const)('Send is disabled when the proposal is %s', async state => {
		findResult = { ok: true, proposal: info({ state }) };
		engine.history = [fakeCheckpoint({ id: 'c2', shared: false })];
		renderPanel(proposalState(true, { shared: { exists: true, ahead: 1, behind: 0 } }));

		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Send More Changes' })).toBeDisabled());
	});

	test('no card shows a git word', async () => {
		findResult = { ok: true, proposal: info({ state: 'changes-requested', overlapsShared: true }) };
		renderPanel(proposalState(true));

		const region = await screen.findByRole('region', { name: 'Your proposal' });
		await vi.waitFor(() => expect(region).toHaveTextContent('asked for changes'));
		expect(region).not.toHaveTextContent(FORBIDDEN_WORDS);
	});
});
