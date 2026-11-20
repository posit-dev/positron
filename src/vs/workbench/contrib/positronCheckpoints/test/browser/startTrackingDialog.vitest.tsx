/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDialogService, IPrompt } from '../../../../../platform/dialogs/common/dialogs.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { UnsavedEditorsDecision } from '../../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { isUsableEmail } from '../../browser/components/startTrackingDialog.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { IProposalController } from '../../browser/proposalController.js';
import { createProposalController } from './proposalTestHelpers.js';
import { fakeCheckpoint, FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

describe('StartTrackingDialog', () => {
	let dirty: IWorkingCopy[] = [];
	let prompted: IPrompt<UnsavedEditorsDecision>[] = [];

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWorkingCopyService, {
			get dirtyWorkingCopies() { return dirty; },
			onDidRegister: new Emitter<IWorkingCopy>().event,
			onDidUnregister: new Emitter<IWorkingCopy>().event,
			onDidChangeDirty: new Emitter<IWorkingCopy>().event,
		})
		.stub(IUriIdentityService, { extUri })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.stub(IDialogService, {
			// Presses the cancel button of every prompt.
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => {
				prompted.push(prompt);
				return { result: await (prompt.cancelButton as { run: () => UnsavedEditorsDecision }).run() };
			},
		})
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;

	beforeEach(() => {
		dirty = [];
		prompted = [];
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const cancel = screen.queryByRole('button', { name: 'Cancel' });
		if (cancel) {
			await userEvent.click(cancel);
		}
	});

	async function openDialog() {
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Start Keeping Checkpoints' }));
		const dialog = await screen.findByRole('dialog');
		return { user, dialog };
	}

	test('identity fields appear only when identity is missing', async () => {
		const { dialog } = await openDialog();

		expect(within(dialog).queryByRole('textbox', { name: 'Your name' })).not.toBeInTheDocument();
		expect(within(dialog).queryByRole('textbox', { name: 'Your email address' })).not.toBeInTheDocument();
		expect(within(dialog).queryByText('Checkpoints records who made each one.')).not.toBeInTheDocument();
	});

	test('identity fields explain why they are needed, and the email needs an @', async () => {
		engine.state = fakeEngineState({ tracking: 'not-a-project', identityMissing: true });
		const { user, dialog } = await openDialog();

		expect(within(dialog).getByText('Checkpoints records who made each one.')).toBeInTheDocument();
		const start = within(dialog).getByRole('button', { name: 'Start' });
		expect(start).toBeDisabled();

		await user.type(within(dialog).getByRole('textbox', { name: 'Your name' }), 'Maya Ortiz');
		await user.type(within(dialog).getByRole('textbox', { name: 'Your email address' }), 'maya.example.org');
		expect(await within(dialog).findByText('Enter an email address that contains @.')).toBeInTheDocument();
		expect(start).toBeDisabled();

		await user.type(within(dialog).getByRole('textbox', { name: 'Your email address' }), '{Backspace>16}maya@example.org');
		expect(start).toBeEnabled();
		await user.click(start);

		await vi.waitFor(() => expect(engine.callsOf('startTracking')).toEqual([
			[{ name: 'Maya Ortiz', email: 'maya@example.org' }, '.Rhistory\n'],
		]));
	});

	test('an identity-missing answer from the engine shows the fields and keeps the dialog open', async () => {
		engine.nextResult = { kind: 'unavailable', reason: 'nothing-to-do', detail: 'identity-missing' };
		const { user, dialog } = await openDialog();
		expect(within(dialog).queryByRole('textbox', { name: 'Your name' })).not.toBeInTheDocument();

		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		expect(await within(dialog).findByRole('textbox', { name: 'Your name' })).toBeInTheDocument();
		expect(within(dialog).getByText('Checkpoints records who made each one.')).toBeInTheDocument();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Start' })).toBeDisabled();
	});

	test('identity-missing with another reason is an ordinary result, not a request for the name and email', async () => {
		engine.nextResult = { kind: 'unavailable', reason: 'busy', detail: 'identity-missing' };
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		expect(await screen.findByText('Another window is working on this project.')).toBeInTheDocument();
		expect(screen.queryByRole('textbox', { name: 'Your name' })).not.toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	test('a failed state read leaves the dialog open with Start enabled again', async () => {
		const { user, dialog } = await openDialog();
		const readState = engine.getState.bind(engine);
		engine.getState = async () => {
			engine.getState = readState;
			throw new Error('state unreadable');
		};

		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		expect(await screen.findByText('That action could not finish. Your project is as it was.')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Start' })).toBeEnabled();
		expect(engine.callsOf('startTracking')).toEqual([]);
	});

	test('the dialog never names the ignore file and proposes the list in an editable box', async () => {
		const { user, dialog } = await openDialog();

		expect(dialog).not.toHaveTextContent(/gitignore/i);
		expect(within(dialog).getByRole('checkbox', { name: 'Leave these files out of checkpoints' })).toBeChecked();
		const box = await within(dialog).findByRole('textbox', { name: 'Files and folders to leave out, one per line' });
		expect(box).toHaveValue('.Rhistory\n');

		await user.type(box, '*.tmp');
		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		await vi.waitFor(() => expect(engine.callsOf('startTracking')).toEqual([[undefined, '.Rhistory\n*.tmp']]));
	});

	test('unticking the ignore list passes no gitignore', async () => {
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('checkbox', { name: 'Leave these files out of checkpoints' }));
		expect(within(dialog).getByRole('textbox', { name: 'Files and folders to leave out, one per line' })).toBeDisabled();
		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		await vi.waitFor(() => expect(engine.callsOf('startTracking')).toEqual([[undefined, undefined]]));
	});

	test('after starting, the view shows one checkpoint', async () => {
		const original = engine.startTracking.bind(engine);
		engine.startTracking = async (identity, gitignore) => {
			const result = await original(identity, gitignore);
			engine.state = fakeEngineState({ shared: { exists: false, ahead: 0, behind: 0 } });
			engine.history = [fakeCheckpoint({ id: 'first', title: 'Start of the dose model' })];
			engine.fireChange();
			return result;
		};
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		expect(await screen.findByText('Start of the dose model')).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Start Keeping Checkpoints' })).not.toBeInTheDocument();
	});

	test('Cancel changes nothing', async () => {
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(engine.callsOf('startTracking')).toEqual([]);
	});

	test('Start waits for the proposed list of files to leave out', async () => {
		let answer!: (proposed: string) => void;
		engine.proposedGitignore = () => new Promise(resolve => { answer = resolve; });
		const { dialog } = await openDialog();

		const start = within(dialog).getByRole('button', { name: 'Start' });
		expect(start).toBeDisabled();
		answer('.Rhistory\n');

		await vi.waitFor(() => expect(start).toBeEnabled());
		expect(within(dialog).getByRole('textbox', { name: 'Files and folders to leave out, one per line' })).toHaveValue('.Rhistory\n');
	});

	test('a list that cannot be read says so, keeps Start disabled, and can be read again', async () => {
		engine.proposedGitignore = async () => { throw new Error('unreadable'); };
		const { user, dialog } = await openDialog();

		expect(await within(dialog).findByText('The list of files to leave out could not be read.')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Start' })).toBeDisabled();

		engine.proposedGitignore = async () => '*.tmp\n';
		await user.click(within(dialog).getByRole('button', { name: 'Try Again' }));

		await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'Start' })).toBeEnabled());
		expect(within(dialog).queryByText('The list of files to leave out could not be read.')).not.toBeInTheDocument();
		expect(within(dialog).getByRole('textbox', { name: 'Files and folders to leave out, one per line' })).toHaveValue('*.tmp\n');
	});

	test('Start asks about unsaved editors first, and Cancel there starts nothing', async () => {
		dirty = [stubInterface<IWorkingCopy>({ resource: URI.file('/work/dose-model/dose.R'), capabilities: WorkingCopyCapabilities.None })];
		const { user, dialog } = await openDialog();

		await user.click(await within(dialog).findByRole('button', { name: 'Start' }));

		await vi.waitFor(() => expect(prompted.map(prompt => prompt.message)).toEqual(['1 file in this project has unsaved edits.']));
		expect(engine.callsOf('startTracking')).toEqual([]);
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});

	test('an identity-missing answer after the fields are filled says the name and email were not recorded', async () => {
		engine.state = fakeEngineState({ tracking: 'not-a-project', identityMissing: true });
		engine.nextResult = { kind: 'unavailable', reason: 'nothing-to-do', detail: 'identity-missing' };
		const { user, dialog } = await openDialog();

		await user.type(within(dialog).getByRole('textbox', { name: 'Your name' }), 'Maya Ortiz');
		await user.type(within(dialog).getByRole('textbox', { name: 'Your email address' }), 'maya@example.org');
		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		expect(await within(dialog).findByText('Checkpoints could not record your name and email. Try again.')).toBeInTheDocument();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Start' })).toBeEnabled();
	});

	test('an email needs text on both sides of an @', () => {
		expect(['a@b', 'a@b.org', ' a@b ', '@b', 'a@', 'ab', ''].map(isUsableEmail)).toEqual([true, true, true, false, false, false, false]);
	});
});
