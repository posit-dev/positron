/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Event } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { UnusualKind } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { IProposalController, ProposalController } from '../../browser/proposalController.js';
import { createProposalController } from './proposalTestHelpers.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { STATE_CHANGE_DELAY_MS } from '../../browser/components/useCheckpointsState.js';
import { fakeCheckpoint, FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

const unusualKinds: UnusualKind[] = ['detached', 'operation-in-progress', 'staged-differs', 'unrecovered', 'git-missing'];

const unusualSentences: Record<UnusualKind, string> = {
	'detached': 'Another git tool left this project looking at an old version instead of the latest one.',
	'operation-in-progress': 'Another git tool left this project in the middle of an operation',
	'staged-differs': 'Another git tool prepared part of a file for its own use, and it no longer matches the file you see.',
	'unrecovered': 'An action was interrupted and this view could not finish it. Your work is saved, and a person who knows git can restore it.',
	'git-missing': 'Version History needs the git program, and it was not found on this computer.',
};

describe('CheckpointsPanel', () => {
	const executeCommand = vi.fn(async () => undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let checkpointsService: CheckpointsService;

	beforeEach(() => {
		executeCommand.mockClear();
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const cancel = screen.queryByRole('button', { name: 'Cancel' });
		if (cancel) {
			await userEvent.click(cancel);
		}
	});

	/** Registers the fake engine and renders the panel. */
	function renderPanel() {
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		rtl.render(<CheckpointsPanel />);
	}

	test('plain folder shows "Start Keeping Versions"', async () => {
		const user = userEvent.setup();
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
		renderPanel();

		const start = await screen.findByRole('button', { name: 'Start Keeping Versions' });
		expect(screen.getByText('This folder is not keeping versions yet.')).toBeInTheDocument();
		expect(screen.queryByTestId('checkpoints-sections')).not.toBeInTheDocument();

		await user.click(start);

		const dialog = await screen.findByRole('dialog');
		expect(engine.callsOf('startTracking')).toEqual([]);
		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		await vi.waitFor(() => expect(engine.callsOf('startTracking')).toEqual([[undefined, '.Rhistory\n']]));
	});

	test.each(unusualKinds)('%s shows its sentence, disables actions, links to Source Control', async kind => {
		const user = userEvent.setup();
		engine.state = fakeEngineState({ unusual: { kind, detail: 'detail from git' } });
		renderPanel();

		expect(await screen.findByText(unusualSentences[kind])).toBeInTheDocument();
		expect(screen.getByTestId('checkpoints-sections')).toBeDisabled();
		expect(engine.callsOf('getChanges')).toEqual([]);

		await user.click(screen.getByRole('button', { name: 'Open Source Control' }));

		expect(executeCommand).toHaveBeenCalledWith('workbench.view.scm');
	});

	test('a missing git program in a plain folder shows its sentence and no Start action', async () => {
		engine.state = fakeEngineState({ tracking: 'not-a-project', unusual: { kind: 'git-missing', detail: 'spawn git ENOENT' } });
		renderPanel();

		expect(await screen.findByText(unusualSentences['git-missing'])).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Start Keeping Versions' })).not.toBeInTheDocument();
	});

	test('behind 2 shows the colleagues-changed sentence', async () => {
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 1, behind: 2 } });
		renderPanel();

		expect(await screen.findByText('Colleagues added 2 versions to the shared copy.')).toBeInTheDocument();
		expect(screen.getByTestId('checkpoints-sections')).toBeEnabled();
	});

	test('ahead 1 shows the waiting-to-send sentence', async () => {
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 1, behind: 0 } });
		renderPanel();

		expect(await screen.findByText('1 version is not yet in the shared copy.')).toBeInTheDocument();
	});

	test('no shared copy shows "This project is only on this computer"', async () => {
		engine.state = fakeEngineState({ shared: { exists: false, ahead: 0, behind: 0 } });
		renderPanel();

		expect(await screen.findByText('This project is only on this computer')).toBeInTheDocument();
	});

	test('sync unavailable names the required git version before the shared copy status', async () => {
		engine.state = fakeEngineState({ syncAvailable: false, shared: { exists: false, ahead: 0, behind: 0 } });
		renderPanel();

		expect(await screen.findByText('Getting and sending changes needs git 2.40 or newer.')).toBeInTheDocument();
	});

	test('an interrupted action comes before the sync status', async () => {
		engine.state = fakeEngineState({
			shared: { exists: true, ahead: 0, behind: 3 },
			interrupted: { operationId: 'op-1', description: 'Get Maya\'s changes', unexpectedPaths: ['dose.R'], indexUnexpected: false },
		});
		renderPanel();

		expect(await screen.findByText('The action "Get Maya\'s changes" was interrupted before it finished.')).toBeInTheDocument();
	});

	test('a folder inside a project shows "This folder is part of the project <name>"', async () => {
		engine.state = fakeEngineState({ openedFolderIsInsideProject: true, projectName: 'dose-model' });
		renderPanel();

		expect(await screen.findByText('This folder is part of the project dose-model')).toBeInTheDocument();
		expect(screen.getByText('You have everything in the shared copy.')).toBeInTheDocument();
	});

	test('without an engine the panel says checkpoints are not available, and loads when one registers', async () => {
		rtl.render(<CheckpointsPanel />);

		expect(await screen.findByText('Version History is not available yet.')).toBeInTheDocument();

		act(() => { ctx.disposables.add(checkpointsService.registerEngine(engine)); });

		expect(await screen.findByText('You have everything in the shared copy.')).toBeInTheDocument();
	});

	test('a state that cannot be read shows a sentence instead of throwing', async () => {
		engine.getState = async () => { throw new Error('extension host stopped'); };
		renderPanel();

		expect(await screen.findByText('The state of this project could not be read.')).toBeInTheDocument();
	});

	test('a read that times out says so on the status line, and a later clean load empties the line', async () => {
		const timedOut = new Error('checkpoints:timed-out git status did not respond in time');
		const readChanges = engine.getChanges.bind(engine);
		engine.getChanges = async () => { throw timedOut; };
		renderPanel();

		expect(await screen.findByText('The project did not respond in time, so part of this view could not be loaded.')).toBeInTheDocument();
		expect(screen.getByText('You have everything in the shared copy.')).toBeInTheDocument();

		engine.getChanges = readChanges;
		act(() => engine.fireChange());

		await vi.waitFor(() => expect(screen.queryByText('The project did not respond in time, so part of this view could not be loaded.')).not.toBeInTheDocument());
	});

	test('a failed state read is logged and says so on the status line', async () => {
		const logError = vi.fn();
		ctx.instantiationService.stub(ILogService, { error: logError });
		const failure = new Error('checkpoints:git-missing spawn git ENOENT');
		engine.getState = async () => { throw failure; };
		renderPanel();

		expect(await screen.findByText('The state of this project could not be read.')).toBeInTheDocument();
		expect(within(screen.getByRole('status')).getByText('Version History needs the git program, and it was not found on this computer.')).toBeInTheDocument();
		expect(logError).toHaveBeenCalledWith('The state of the project could not be read.', failure);
	});

	test('the panel refreshes when the service fires onDidChangeState', async () => {
		renderPanel();
		expect(await screen.findByText('You have everything in the shared copy.')).toBeInTheDocument();

		engine.state = fakeEngineState({ shared: { exists: true, ahead: 0, behind: 1 } });
		act(() => engine.fireChange());

		expect(await screen.findByText('Colleagues added 1 version to the shared copy.')).toBeInTheDocument();
	});

	test('a change during a load queues one more load, and the older response is dropped', async () => {
		// The proposal controller reads the state too, so it is replaced by one with a service without the engine.
		(ctx.instantiationService.get(IProposalController) as ProposalController).dispose();
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables, undefined, ctx.disposables.add(new CheckpointsService(new NullLogService()))));
		const releaseFirst = engine.holdGetState();
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 0, behind: 2 } });
		renderPanel();

		act(() => engine.fireChange());
		// The change waits out the gathering delay, then queues behind the running load.
		await act(() => new Promise(resolve => setTimeout(resolve, STATE_CHANGE_DELAY_MS + 50)));
		expect(engine.callsOf('getState')).toHaveLength(1);
		await act(async () => releaseFirst(fakeEngineState()));

		expect(await screen.findByText('Colleagues added 2 versions to the shared copy.')).toBeInTheDocument();
		expect(screen.queryByText('You have everything in the shared copy.')).not.toBeInTheDocument();
		expect(engine.callsOf('getState')).toHaveLength(2);
	});

	test('a recovery notice is shown once on the status line', async () => {
		engine.state = fakeEngineState({ recoveryNotice: 'reversed' });
		renderPanel();

		await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('An action was interrupted when Positron closed. It has been reversed.'));

		act(() => ctx.instantiationService.get(ICheckpointsMessageService).show('A later sentence'));
		engine.state = fakeEngineState({ recoveryNotice: 'reversed', shared: { exists: true, ahead: 0, behind: 1 } });
		act(() => engine.fireChange());

		expect(await screen.findByText('Colleagues added 1 version to the shared copy.')).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('A later sentence');
	});

	test('the result of an action is shown on the status line', async () => {
		const user = userEvent.setup();
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
		engine.nextResult = { kind: 'unavailable', reason: 'busy' };
		renderPanel();

		await user.click(await screen.findByRole('button', { name: 'Start Keeping Versions' }));
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' }));

		expect(await screen.findByRole('status')).toHaveTextContent('Another window is working on this project');
	});

	test('a project without a proposal and without a refusal renders no text about proposals or review', async () => {
		engine.state = fakeEngineState({ sharedUrl: 'https://github.com/me/dose-model.git', shared: { exists: true, ahead: 1, behind: 0 } });
		engine.history = [fakeCheckpoint({ shared: false })];
		renderPanel();

		expect(await screen.findByRole('button', { name: 'Send Changes' })).toBeInTheDocument();
		expect(document.body).not.toHaveTextContent(/proposal|review/i);
	});

	test.each([
		['GitHub', 'https://github.com/me/dose-model.git', true],
		['another host', 'https://gitlab.com/me/dose-model.git', false],
	])('a Send refused for review on %s shows the review card: %s', async (_host, sharedUrl, shown) => {
		const user = userEvent.setup();
		engine.state = fakeEngineState({ sharedUrl, shared: { exists: true, ahead: 1, behind: 0 } });
		engine.history = [fakeCheckpoint({ shared: false })];
		engine.nextResult = { kind: 'rejected', reason: 'review-required', detail: 'GH006: Protected branch update failed' };
		renderPanel();

		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));

		expect(await screen.findByRole('status')).toHaveTextContent('The shared copy needs a colleague to review changes before they join it.');
		const card = screen.queryByText('This project needs a colleague to review changes before they join the shared copy.');
		expect({ card: card !== null, ask: screen.queryByRole('button', { name: 'Ask for a Review' }) !== null }).toEqual({ card: shown, ask: shown });
	});

	test('Dismiss hides the review card', async () => {
		const user = userEvent.setup();
		engine.state = fakeEngineState({ sharedUrl: 'https://github.com/me/dose-model.git', shared: { exists: true, ahead: 1, behind: 0 } });
		engine.history = [fakeCheckpoint({ shared: false })];
		engine.nextResult = { kind: 'rejected', reason: 'review-required', detail: 'GH006' };
		renderPanel();
		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));

		await user.click(await screen.findByRole('button', { name: 'Dismiss' }));

		expect(screen.queryByRole('button', { name: 'Ask for a Review' })).not.toBeInTheDocument();
	});
});
