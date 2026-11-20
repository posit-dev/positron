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
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { UnsavedEditorsDecision } from '../../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { showCheckResultDialog } from '../../browser/components/checkResultDialog.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { FakeCheckpointsEngine, fakeChangedFile, fakeCheckpoint, fakeEngineState } from './fakeCheckpointsEngine.js';

describe('Recovery and project check dialogs', () => {
	const openEditor = vi.fn(async () => undefined);
	let dirty: IWorkingCopy[] = [];
	let prompted: string[][] = [];

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
			// Records the buttons of every prompt and presses its cancel button.
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => {
				prompted.push(prompt.buttons!.map(button => button.label));
				return { result: await (prompt.cancelButton as { run: () => UnsavedEditorsDecision }).run() };
			},
		})
		.stub(IFileService, {})
		.stub(IEditorService, { openEditor })
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let messageService: CheckpointsMessageService;

	const interrupted = {
		operationId: 'op-5',
		description: 'Getting Maya\'s changes',
		unexpectedPaths: ['a.R', 'notes/b.R'],
		indexUnexpected: true,
	};

	beforeEach(() => {
		openEditor.mockClear();
		dirty = [];
		prompted = [];
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		messageService = ctx.disposables.add(new CheckpointsMessageService());
		ctx.instantiationService.stub(ICheckpointsMessageService, messageService);
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		for (const name of ['Close', 'Decide Later']) {
			const close = screen.queryByRole('button', { name });
			if (close) {
				await userEvent.click(close);
			}
		}
	});

	/** Renders the panel with one unshared checkpoint, so that Send Changes gives a result to route. */
	async function renderWithSend() {
		engine.history = [fakeCheckpoint({ id: 'c1', title: 'Mine', shared: false })];
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));
		return user;
	}

	test('interrupted dialog offers the two choices and lists the files', async () => {
		engine.state = fakeEngineState({ interrupted, recoverySnapshots: [{ operationId: 'op-5', time: '2026-11-19T10:00:00Z' }] });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		expect(await screen.findByText('Getting Maya\'s changes was interrupted, and 2 files were changed afterwards.')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Choose What to Do' }));

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('Getting Maya\'s changes was interrupted, and 2 files were changed afterwards.')).toBeInTheDocument();
		const files = within(dialog).getByRole('list', { name: 'These files were changed afterwards:' });
		expect(within(files).getAllByRole('listitem').map(item => item.textContent)).toEqual(['a.R', 'notes/b.R']);
		expect(within(dialog).getByText('Work set aside by another git tool was also changed.')).toBeInTheDocument();
		expect(within(dialog).getByText('Project as it was before recovery')).toBeInTheDocument();

		await user.click(within(dialog).getByRole('button', { name: 'Reverse the Action and Keep My Newer Files' }));

		await vi.waitFor(() => expect(engine.callsOf('resolveInterrupted')).toEqual([['reverse-keep-newer']]));
	});

	test('Leave the project as it is sends the other choice', async () => {
		engine.state = fakeEngineState({ interrupted });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Choose What to Do' }));
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave the Project as It Is' }));

		await vi.waitFor(() => expect(engine.callsOf('resolveInterrupted')).toEqual([['leave-as-is']]));
	});

	test('reversing asks to save unsaved files first, and leaving the project as it is does not', async () => {
		dirty = [stubInterface<IWorkingCopy>({ resource: URI.file('/work/dose-model/a.R'), capabilities: WorkingCopyCapabilities.None })];
		engine.state = fakeEngineState({ interrupted });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Choose What to Do' }));
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reverse the Action and Keep My Newer Files' }));

		await vi.waitFor(() => expect(prompted).toEqual([['Save all and continue']]));
		expect(engine.callsOf('resolveInterrupted')).toEqual([]);

		await user.click(await screen.findByRole('button', { name: 'Choose What to Do' }));
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave the Project as It Is' }));

		await vi.waitFor(() => expect(engine.callsOf('resolveInterrupted')).toEqual([['leave-as-is']]));
		expect(prompted).toHaveLength(1);
	});

	test('a recovery snapshot can be removed from the dialog', async () => {
		engine.state = fakeEngineState({ interrupted, recoverySnapshots: [{ operationId: 'op-5', time: '2026-11-19T10:00:00Z' }] });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Choose What to Do' }));
		const dialog = await screen.findByRole('dialog');
		await user.click(within(dialog).getByRole('button', { name: /^Remove: Project as it was before recovery/ }));

		await vi.waitFor(() => expect(engine.callsOf('removeRecoverySnapshot')).toEqual([['op-5']]));
		expect(within(dialog).queryByText('Project as it was before recovery')).not.toBeInTheDocument();
	});

	test('a recovery snapshot stays listed in the view and can be removed there', async () => {
		engine.state = fakeEngineState({ recoverySnapshots: [{ operationId: 'op-5', time: '2026-11-19T10:00:00Z' }] });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		expect(await screen.findByText('Project as it was before recovery')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: /^Remove: Project as it was before recovery/ }));

		await vi.waitFor(() => expect(engine.callsOf('removeRecoverySnapshot')).toEqual([['op-5']]));
	});

	test('an interrupted result opens the interrupted dialog from the state', async () => {
		engine.state = fakeEngineState({ interrupted });
		engine.nextResult = { kind: 'interrupted' };
		await renderWithSend();

		const dialog = await screen.findByRole('dialog');

		expect(within(dialog).getByRole('button', { name: 'Leave the Project as It Is' })).toBeInTheDocument();
	});

	test('check-failed shows the output only under Show git details', async () => {
		engine.nextResult = { kind: 'check-failed', output: 'lint error on line 3', hookEditedFiles: ['a.R'] };
		const user = await renderWithSend();

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('A check set up for this project did not pass. The check also changed 1 file on disk. Create the checkpoint again to include these changes.')).toBeInTheDocument();
		expect(within(dialog).getByRole('list', { name: 'Files the check changed on disk:' })).toHaveTextContent('a.R');
		expect(screen.queryByText('lint error on line 3')).not.toBeInTheDocument();

		await user.click(within(dialog).getByRole('button', { name: 'Show Git Details' }));

		expect(within(dialog).getByText('lint error on line 3')).toBeInTheDocument();
	});

	test('check-changed-checkpoint Accept and Decline call the engine with the token', async () => {
		engine.nextResult = { kind: 'check-changed-checkpoint', token: 'tok-1', changedPaths: ['a.R', 'b.R'], hookEditedFiles: [] };
		engine.pendingFiles.set('tok-1', [fakeChangedFile('a.R'), fakeChangedFile('b.R', { status: 'added' })]);
		const user = await renderWithSend();

		let dialog = await screen.findByRole('dialog');
		const changed = within(dialog).getByRole('list', { name: 'Files the check changed:' });
		await vi.waitFor(() => expect(within(changed).getAllByRole('listitem').map(item => item.firstChild?.textContent)).toEqual(['a.R', 'b.R']));
		engine.nextResult = { kind: 'done', operationId: 'op-6', hookEditedFiles: [] };
		await user.click(within(dialog).getByRole('button', { name: 'Create the Checkpoint with These Changes' }));
		await vi.waitFor(() => expect(engine.callsOf('acceptCheckedCheckpoint')).toEqual([['tok-1']]));

		engine.nextResult = { kind: 'check-changed-checkpoint', token: 'tok-2', changedPaths: ['a.R'], hookEditedFiles: [] };
		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));
		dialog = await screen.findByRole('dialog');
		engine.nextResult = { kind: 'done', operationId: 'op-7', hookEditedFiles: ['a.R'] };
		await user.click(within(dialog).getByRole('button', { name: 'Do Not Create the Checkpoint' }));

		await vi.waitFor(() => expect(engine.callsOf('declineCheckedCheckpoint')).toEqual([['tok-2']]));
		expect(await screen.findByText('The check also changed 1 file on disk.')).toBeInTheDocument();
	});

	test('a pending approval in state reopens the dialog after a restart', async () => {
		engine.state = fakeEngineState({ pendingApproval: { token: 'tok-9', changedPaths: ['dose.R'], hookEditedFiles: [] } });
		engine.pendingFiles.set('tok-9', [fakeChangedFile('dose.R')]);
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		expect(await screen.findByText('A check set up for this project also changed these files.')).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Review the Changes' }));

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByRole('list', { name: 'Files the check changed:' })).toHaveTextContent(/^dose\.R/);
		await user.click(within(dialog).getByRole('button', { name: 'Create the Checkpoint with These Changes' }));

		await vi.waitFor(() => expect(engine.callsOf('acceptCheckedCheckpoint')).toEqual([['tok-9']]));
	});

	test('removing a recovery snapshot in the dialog refreshes the view', async () => {
		engine.state = fakeEngineState({ interrupted, recoverySnapshots: [{ operationId: 'op-5', time: '2026-11-19T10:00:00Z' }] });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Choose What to Do' }));
		const dialog = await screen.findByRole('dialog');
		engine.state = fakeEngineState({ interrupted });
		const readsBefore = engine.callsOf('getState').length;

		await user.click(within(dialog).getByRole('button', { name: /^Remove: Project as it was before recovery/ }));

		await vi.waitFor(() => expect(engine.callsOf('getState').length).toBeGreaterThan(readsBefore));
		await vi.waitFor(() => expect(screen.queryByText('Project as it was before recovery')).not.toBeInTheDocument());
	});

	test('removing a recovery snapshot in a dialog opened from a result refreshes the view', async () => {
		engine.state = fakeEngineState({ interrupted, recoverySnapshots: [{ operationId: 'op-5', time: '2026-11-19T10:00:00Z' }] });
		engine.nextResult = { kind: 'interrupted' };
		const user = await renderWithSend();
		const dialog = await screen.findByRole('dialog');
		engine.state = fakeEngineState({ interrupted });
		const readsBefore = engine.callsOf('getState').length;

		await user.click(within(dialog).getByRole('button', { name: /^Remove: Project as it was before recovery/ }));

		await vi.waitFor(() => expect(engine.callsOf('getState').length).toBeGreaterThan(readsBefore));
		await vi.waitFor(() => expect(screen.queryByText('Project as it was before recovery')).not.toBeInTheDocument());
	});

	test('dismissing each dialog without a choice calls nothing on the engine', async () => {
		const decisions = ['resolveInterrupted', 'acceptCheckedCheckpoint', 'declineCheckedCheckpoint', 'removeRecoverySnapshot'] as const;
		const user = userEvent.setup();
		engine.state = fakeEngineState({ interrupted, pendingApproval: { token: 'tok-9', changedPaths: ['dose.R'], hookEditedFiles: [] } });
		engine.history = [fakeCheckpoint({ id: 'c1', title: 'Mine', shared: false })];
		rtl.render(<CheckpointsPanel />);

		await user.click(await screen.findByRole('button', { name: 'Choose What to Do' }));
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Decide Later' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

		await user.click(screen.getByRole('button', { name: 'Choose What to Do' }));
		expect(await screen.findByRole('dialog')).toBeInTheDocument();
		await user.keyboard('{Escape}');
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

		await user.click(screen.getByRole('button', { name: 'Review the Changes' }));
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

		engine.nextResult = { kind: 'check-failed', output: 'lint error', hookEditedFiles: [] };
		await user.click(screen.getByRole('button', { name: 'Send Changes' }));
		expect(await screen.findByRole('dialog')).toBeInTheDocument();
		await user.keyboard('{Escape}');
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

		expect(decisions.flatMap(method => engine.callsOf(method))).toEqual([]);
	});

	test('View detailed differences opens the file as the check changed it', async () => {
		engine.state = fakeEngineState({ pendingApproval: { token: 'tok-9', changedPaths: ['dose.R'], hookEditedFiles: [] } });
		engine.pendingFiles.set('tok-9', [fakeChangedFile('dose.R')]);
		engine.diff = { left: { kind: 'blob', oid: 'before' }, right: { kind: 'blob', oid: 'after' } };
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Review the Changes' }));
		const dialog = await screen.findByRole('dialog');

		await user.click(within(dialog).getByRole('button', { name: 'View Detailed Differences: dose.R' }));

		await vi.waitFor(() => expect(engine.callsOf('getDiff')).toEqual([[{ kind: 'pending', token: 'tok-9', path: 'dose.R' }]]));
		await vi.waitFor(() => expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ label: 'dose.R (as the check changed it)' })));
	});

	test('the files of a pending approval come from the engine, each with its status word and its differences', async () => {
		engine.state = fakeEngineState({ pendingApproval: { token: 'tok-9', changedPaths: ['dose.R'], hookEditedFiles: [] } });
		engine.pendingFiles.set('tok-9', [fakeChangedFile('dose.R'), fakeChangedFile('notes.md', { status: 'added' })]);
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Review the Changes' }));
		const dialog = await screen.findByRole('dialog');

		const changed = within(dialog).getByRole('list', { name: 'Files the check changed:' });
		await vi.waitFor(() => expect(within(changed).getAllByRole('listitem').map(item => item.textContent)).toEqual([
			'dose.RchangedView Detailed Differences',
			'notes.mdnewView Detailed Differences',
		]));
		expect(engine.callsOf('getPendingFiles')).toEqual([['tok-9']]);
		expect(within(dialog).getByText('The comparison opens when you close this window.')).toBeInTheDocument();
		await user.click(within(dialog).getByRole('button', { name: 'View Detailed Differences: notes.md' }));

		await vi.waitFor(() => expect(engine.callsOf('getDiff')).toEqual([[{ kind: 'pending', token: 'tok-9', path: 'notes.md' }]]));
	});

	test('pending files that cannot be read leave the paths of the result and say so on the status line', async () => {
		engine.state = fakeEngineState({ pendingApproval: { token: 'tok-9', changedPaths: ['dose.R'], hookEditedFiles: [] } });
		engine.getPendingFiles = async () => { throw new Error('checkpoints:timed-out git diff-tree did not respond in time'); };
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Review the Changes' }));
		const dialog = await screen.findByRole('dialog');

		await vi.waitFor(() => expect(messageService.message).toBe('The project did not respond in time, so part of this view could not be loaded.'));
		expect(within(dialog).getByRole('list', { name: 'Files the check changed:' })).toHaveTextContent(/^dose\.R/);
	});

	test('a project check result names the checkpoint that was not created when there were several', async () => {
		const actions = { run: vi.fn(async () => undefined), removeRecoverySnapshot: vi.fn(async () => true) };
		showCheckResultDialog({ kind: 'check-failed', output: '', hookEditedFiles: [], chunkIndex: 1 }, actions, 3);

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('Checkpoint 2 of 3 was not created.')).toBeInTheDocument();
		await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

		showCheckResultDialog({ kind: 'check-failed', output: '', hookEditedFiles: [], chunkIndex: 0 }, actions, 1);
		const single = await screen.findByRole('dialog');
		expect(within(single).queryByText(/was not created/)).not.toBeInTheDocument();
	});

	test('an interrupted action in state opens no dialog until the card is used', async () => {
		engine.state = fakeEngineState({ interrupted });
		rtl.render(<CheckpointsPanel />);

		expect(await screen.findByRole('button', { name: 'Choose What to Do' })).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
