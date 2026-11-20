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
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { UnusualKind } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

const unusualKinds: UnusualKind[] = ['detached', 'operation-in-progress', 'staged-differs', 'unrecovered', 'git-missing'];

const unusualSentences: Record<UnusualKind, string> = {
	'detached': 'Another git tool left this project looking at an old version instead of the latest one.',
	'operation-in-progress': 'Another git tool left this project in the middle of an operation',
	'staged-differs': 'Another git tool prepared part of a file for its own use, and it no longer matches the file you see.',
	'unrecovered': 'An action was interrupted and this view could not finish it. Your work is saved, and a person who knows git can restore it.',
	'git-missing': 'Checkpoints need the git program, and it was not found on this computer.',
};

describe('CheckpointsPanel', () => {
	const executeCommand = vi.fn(async () => undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
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

	test('plain folder shows "Start keeping checkpoints"', async () => {
		const user = userEvent.setup();
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
		renderPanel();

		const start = await screen.findByRole('button', { name: 'Start keeping checkpoints' });
		expect(screen.getByText('This folder is not keeping checkpoints yet.')).toBeInTheDocument();
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
		expect(screen.queryByRole('button', { name: 'Start keeping checkpoints' })).not.toBeInTheDocument();
	});

	test('behind 2 shows the colleagues-changed sentence', async () => {
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 1, behind: 2 } });
		renderPanel();

		expect(await screen.findByText('Colleagues added 2 checkpoints to the shared copy.')).toBeInTheDocument();
		expect(screen.getByTestId('checkpoints-sections')).toBeEnabled();
	});

	test('ahead 1 shows the waiting-to-send sentence', async () => {
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 1, behind: 0 } });
		renderPanel();

		expect(await screen.findByText('1 checkpoint is not yet in the shared copy.')).toBeInTheDocument();
	});

	test('no shared copy shows "This project is only on this computer"', async () => {
		engine.state = fakeEngineState({ shared: { exists: false, ahead: 0, behind: 0 } });
		renderPanel();

		expect(await screen.findByText('This project is only on this computer')).toBeInTheDocument();
	});

	test('sync unavailable names the required git version before the shared copy status', async () => {
		engine.state = fakeEngineState({ syncAvailable: false, shared: { exists: false, ahead: 0, behind: 0 } });
		renderPanel();

		expect(await screen.findByText('Getting and sending changes needs git version 2.40 or newer.')).toBeInTheDocument();
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

		expect(await screen.findByText('Checkpoints are not available yet.')).toBeInTheDocument();

		act(() => { ctx.disposables.add(checkpointsService.registerEngine(engine)); });

		expect(await screen.findByText('You have everything in the shared copy.')).toBeInTheDocument();
	});

	test('a state that cannot be read shows a sentence instead of throwing', async () => {
		engine.getState = async () => { throw new Error('extension host stopped'); };
		renderPanel();

		expect(await screen.findByText('The state of this project could not be read.')).toBeInTheDocument();
	});

	test('the panel refreshes when the service fires onDidChangeState', async () => {
		renderPanel();
		expect(await screen.findByText('You have everything in the shared copy.')).toBeInTheDocument();

		engine.state = fakeEngineState({ shared: { exists: true, ahead: 0, behind: 1 } });
		act(() => engine.fireChange());

		expect(await screen.findByText('Colleagues added 1 checkpoint to the shared copy.')).toBeInTheDocument();
	});

	test('a response from a superseded load is ignored', async () => {
		const releaseFirst = engine.holdGetState();
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 0, behind: 2 } });
		renderPanel();

		act(() => engine.fireChange());
		expect(await screen.findByText('Colleagues added 2 checkpoints to the shared copy.')).toBeInTheDocument();

		await act(async () => releaseFirst(fakeEngineState()));

		expect(screen.getByText('Colleagues added 2 checkpoints to the shared copy.')).toBeInTheDocument();
		expect(screen.queryByText('You have everything in the shared copy.')).not.toBeInTheDocument();
	});

	test('the result of an action is shown on the status line', async () => {
		const user = userEvent.setup();
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
		engine.nextResult = { kind: 'unavailable', reason: 'busy' };
		renderPanel();

		await user.click(await screen.findByRole('button', { name: 'Start keeping checkpoints' }));
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start' }));

		expect(await screen.findByRole('status')).toHaveTextContent('Another window is working on this project');
	});
});
