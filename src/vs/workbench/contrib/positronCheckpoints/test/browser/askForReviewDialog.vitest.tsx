/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IEngineState } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { IGitHubClient } from '../../browser/github/githubClient.js';
import { IProposalController } from '../../browser/proposalController.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { describeProposalJob } from '../../common/agent/describeProposal.js';
import { FORBIDDEN_WORDS } from '../../common/forbiddenWords.js';
import { FakeCheckpointsAgentService } from './fakeAgentService.js';
import { fakeChangedFile, fakeCheckpoint, FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';
import { createProposalController, fakeProposalGitHub } from './proposalTestHelpers.js';

const GITHUB_URL = 'https://github.com/me/dose-model.git';
const BRANCH = 'proposal/fit-the-dose-model';

/** A project on GitHub whose last Send was refused, with two unshared checkpoints. */
function unsharedState(overrides: Partial<IEngineState> = {}): IEngineState {
	return fakeEngineState({ sharedUrl: GITHUB_URL, shared: { exists: true, ahead: 2, behind: 0 }, ...overrides });
}

describe('AskForReviewDialog', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let agent: FakeCheckpointsAgentService;
	let github: IGitHubClient;

	beforeEach(() => {
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		agent = ctx.disposables.add(new FakeCheckpointsAgentService(false));
		github = fakeProposalGitHub({ openProposal: vi.fn<IGitHubClient['openProposal']>(async () => ({ ok: true, url: 'https://github.com/me/dose-model/pull/7', number: 7 })) });
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsAgentService, agent);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables, github));
		engine.state = unsharedState({ proposal: { branch: BRANCH, base: 'main', sent: false } });
		engine.history = [
			fakeCheckpoint({ id: 'c3', title: 'Add the residual plot', body: '', shared: false }),
			fakeCheckpoint({ id: 'c2', title: 'Fit the dose model with a random slope', body: 'Uses lme4.', shared: false }),
			fakeCheckpoint({ id: 'c1', title: 'First version', shared: true }),
		];
		engine.checkpointFiles.set('c2', [fakeChangedFile('model.R')]);
		engine.checkpointFiles.set('c3', [fakeChangedFile('plots.R')]);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const close = screen.queryByRole('button', { name: 'Cancel' }) ?? screen.queryByRole('button', { name: 'Close' });
		if (close) {
			await userEvent.click(close);
		}
	});

	/** Renders the panel and opens the dialog from the proposal card. */
	async function openDialog() {
		const user = userEvent.setup();
		rtl.render(<CheckpointsPanel />);
		await user.click(await screen.findByRole('button', { name: 'Ask for a Review' }));
		const dialog = await screen.findByRole('dialog');
		expect(await within(dialog).findByText('2 checkpoints go to your colleagues for review. Your files do not change.')).toBeInTheDocument();
		return { user, dialog };
	}

	test('the title is the oldest checkpoint, and the message lists the checkpoints', async () => {
		const { dialog } = await openDialog();

		expect({
			title: within(dialog).getByRole('textbox', { name: 'Title' }),
			message: within(dialog).getByRole('textbox', { name: 'Message' }),
		}).toEqual({
			title: expect.objectContaining({ value: 'Fit the dose model with a random slope' }),
			message: expect.objectContaining({ value: '- Fit the dose model with a random slope\n  Uses lme4.\n- Add the residual plot' }),
		});
		expect(dialog).not.toHaveTextContent(FORBIDDEN_WORDS);
	});

	test('the agent text replaces an unedited message, with the changed files as input', async () => {
		agent.setAvailable(true);
		agent.answers.set(describeProposalJob.name, { ok: true, value: { title: 'Random slope', body: 'This adds a random slope.' }, fromCache: false });
		const { dialog } = await openDialog();

		await vi.waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Message' })).toHaveValue('This adds a random slope.'));
		expect(agent.runs[0].input).toEqual({
			checkpoints: [{ id: 'c2', title: 'Fit the dose model with a random slope', body: 'Uses lme4.' }, { id: 'c3', title: 'Add the residual plot', body: '' }],
			changedPaths: ['model.R', 'plots.R'],
		});
	});

	test('the agent text leaves an edited message alone', async () => {
		agent.setAvailable(true);
		const answer = agent.hold(describeProposalJob.name);
		const { user, dialog } = await openDialog();
		const message = within(dialog).getByRole('textbox', { name: 'Message' });

		await user.clear(message);
		await user.type(message, 'My own words');
		await act(async () => {
			answer({ ok: true, value: { title: 'Random slope', body: 'This adds a random slope.' }, fromCache: false });
			// The outcome resolves in a later microtask; the loop lets every pending step run.
			for (let i = 0; i < 10; i++) {
				await Promise.resolve();
			}
		});

		expect(message).toHaveValue('My own words');
	});

	test('each step is named while it runs, and the dialog closes after the review was asked for', async () => {
		const answers: ((value: { ok: true; url: string; number: number }) => void)[] = [];
		vi.mocked(github.openProposal).mockImplementation(() => new Promise(resolve => answers.push(resolve)));
		engine.afterOperation = method => {
			if (method === 'sendChanges') {
				engine.state = unsharedState({ proposal: { branch: BRANCH, base: 'main', sent: true }, shared: { exists: true, ahead: 0, behind: 0 } });
			}
		};
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Ask for a Review' }));

		expect(await within(dialog).findByText('Asking for the review...')).toBeInTheDocument();
		expect(engine.callsOf('sendChanges')).toEqual([[]]);
		answers[0]({ ok: true, url: 'https://github.com/me/dose-model/pull/7', number: 7 });
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(github.openProposal).toHaveBeenCalledWith('me', 'dose-model', BRANCH, 'main', 'Fit the dose model with a random slope', '- Fit the dose model with a random slope\n  Uses lme4.\n- Add the residual plot');
	});

	test('a failed send says what was done, and Try Again runs the send again only', async () => {
		engine.queuedResults = [{ kind: 'rejected', reason: 'offline', detail: 'no route' }];
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Ask for a Review' }));

		expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your proposal is ready on this computer, but your checkpoints could not be sent. The shared copy could not be reached. Check your connection and try again.');
		await user.click(within(dialog).getByRole('button', { name: 'Try Again' }));

		await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect({ start: engine.callsOf('startProposal'), send: engine.callsOf('sendChanges').length }).toEqual({ start: [], send: 2 });
	});

	test('a failed request to GitHub says the checkpoints were sent', async () => {
		vi.mocked(github.openProposal).mockResolvedValue({ ok: false, reason: 'not-allowed', detail: '403' });
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Ask for a Review' }));

		expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your checkpoints were sent, but the review could not be asked for. GitHub does not let your account ask for a review in this project.');
	});

	test('the dialog opened again for the same proposal keeps the title, message, and count of the last attempt', async () => {
		vi.mocked(github.openProposal).mockResolvedValue({ ok: false, reason: 'offline', detail: 'fetch failed' });
		engine.afterOperation = method => {
			if (method === 'sendChanges') {
				engine.state = unsharedState({ proposal: { branch: BRANCH, base: 'main', sent: true }, shared: { exists: true, ahead: 0, behind: 0 } });
				engine.history = engine.history.map(checkpoint => ({ ...checkpoint, shared: true }));
			}
		};
		const { user, dialog } = await openDialog();
		const title = within(dialog).getByRole('textbox', { name: 'Title' });
		await user.clear(title);
		await user.type(title, 'Random slope');
		await user.click(within(dialog).getByRole('button', { name: 'Ask for a Review' }));
		expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
		await user.click(within(dialog).getByRole('button', { name: 'Close' }));

		await user.click(await screen.findByRole('button', { name: 'Ask for a Review' }));
		const reopened = await screen.findByRole('dialog');

		expect(await within(reopened).findByText('2 checkpoints go to your colleagues for review. Your files do not change.')).toBeInTheDocument();
		expect(within(reopened).getByRole('textbox', { name: 'Title' })).toHaveValue('Random slope');
		expect(within(reopened).getByRole('textbox', { name: 'Message' })).toHaveValue('- Fit the dose model with a random slope\n  Uses lme4.\n- Add the residual plot');
	});

	test('for a sent proposal with no earlier attempt, the dialog starts from the newest checkpoint and gives no count', async () => {
		engine.state = unsharedState({ proposal: { branch: BRANCH, base: 'main', sent: true }, shared: { exists: true, ahead: 0, behind: 0 } });
		engine.history = engine.history.map(checkpoint => ({ ...checkpoint, shared: true }));
		const user = userEvent.setup();
		rtl.render(<CheckpointsPanel />);
		await user.click(await screen.findByRole('button', { name: 'Ask for a Review' }));
		const dialog = await screen.findByRole('dialog');

		expect(await within(dialog).findByText('Your checkpoints go to your colleagues for review. Your files do not change.')).toBeInTheDocument();
		expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Add the residual plot');
	});
});
