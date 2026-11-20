/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

describe('Undo and Redo', () => {
	const showInstantHover = vi.fn();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWorkingCopyService, {
			dirtyWorkingCopies: [],
			onDidRegister: new Emitter<IWorkingCopy>().event,
			onDidUnregister: new Emitter<IWorkingCopy>().event,
			onDidChangeDirty: new Emitter<IWorkingCopy>().event,
		})
		.stub(IUriIdentityService, { extUri })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.stub(IHoverService, { showInstantHover, hideHover: vi.fn() })
		.stub(IDialogService, {})
		.stub(IFileService, {})
		.stub(IEditorService, {})
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;

	beforeEach(() => {
		showInstantHover.mockClear();
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	const undoEntry = { operationId: 'op-2', description: 'Get Maya\'s changes' };
	const redoEntry = { operationId: 'op-3', description: 'Go back to First version' };

	test('Undo and Redo name their actions and appear only when available', async () => {
		engine.state = fakeEngineState();
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Undo:/ })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Redo:/ })).not.toBeInTheDocument();

		engine.state = fakeEngineState({ undo: undoEntry });
		await act(async () => engine.fireChange());
		expect(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Redo:/ })).not.toBeInTheDocument();

		engine.state = fakeEngineState({ undo: undoEntry, redo: redoEntry });
		await act(async () => engine.fireChange());
		expect(await screen.findByRole('button', { name: 'Redo: Go back to First version' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Undo: Get Maya\'s changes' })).toBeInTheDocument();
	});

	test('the hover text of Undo states the limit', async () => {
		engine.state = fakeEngineState({ undo: undoEntry });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.hover(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' }));

		await vi.waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
			expect.objectContaining({ content: 'Undo covers your last 50 actions from the last 30 days.' }),
			false
		));
	});

	test('Undo and Redo call the engine with the operation id and no collision choices', async () => {
		engine.state = fakeEngineState({ undo: undoEntry, redo: redoEntry });
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' }));
		await vi.waitFor(() => expect(engine.callsOf('undo')).toEqual([['op-2', []]]));
		await user.click(screen.getByRole('button', { name: 'Redo: Go back to First version' }));

		await vi.waitFor(() => expect(engine.callsOf('redo')).toEqual([['op-3', []]]));
	});

	test('undo of a file-restoring action warns with the count of changed files', async () => {
		engine.state = fakeEngineState({ undo: { ...undoEntry, restoresFiles: true } });
		engine.changes = { basis: 'after-the-action', files: [] };
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' })).toBeInTheDocument();
		expect(screen.queryByText(/You changed/)).not.toBeInTheDocument();

		engine.changes = {
			basis: 'after-an-edit',
			files: ['a.R', 'b.R', 'c.R'].map(path => ({ path, status: 'modified', binary: false, sizeBytes: 10, tooLarge: false, hunks: [] })),
		};
		await act(async () => engine.fireChange());

		expect(await screen.findByText('You changed 3 files since then. Undo will set them back, and Redo will return them.')).toBeInTheDocument();
	});

	test('an action that leaves files as they are shows no count', async () => {
		for (const entry of [{ ...undoEntry, kind: 'edit-description' as const, restoresFiles: false }, undoEntry]) {
			engine.state = fakeEngineState({ undo: entry });
			engine.changes = { basis: 'after-the-action', files: [] };
			const { unmount } = rtl.render(<CheckpointsPanel />);
			expect(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' })).toBeInTheDocument();
			const loads = engine.callsOf('getChanges').length;

			engine.changes = { basis: 'after-an-edit', files: [{ path: 'a.R', status: 'modified', binary: false, sizeBytes: 1, tooLarge: false, hunks: [] }] };
			await act(async () => engine.fireChange());
			await vi.waitFor(() => expect(engine.callsOf('getChanges').length).toBeGreaterThan(loads));

			expect(screen.queryByText(/You changed/)).not.toBeInTheDocument();
			unmount();
		}
	});

	test('a Redo that returns to an earlier pair of actions shows no stale count', async () => {
		const restoring = { ...undoEntry, restoresFiles: true };
		const edited = (path: string) => ({ path, status: 'modified' as const, binary: false, sizeBytes: 1, tooLarge: false, hunks: [] });
		engine.state = fakeEngineState({ undo: restoring });
		engine.changes = { basis: 'b1', files: [] };
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' })).toBeInTheDocument();

		// Undo: the action moves to the redo list.
		engine.state = fakeEngineState({ redo: restoring });
		engine.changes = { basis: 'b2', files: [] };
		await act(async () => engine.fireChange());
		expect(await screen.findByRole('button', { name: 'Redo: Get Maya\'s changes' })).toBeInTheDocument();

		// Redo: the pair of the first load again, with files that differ from that load.
		engine.state = fakeEngineState({ undo: restoring });
		engine.changes = { basis: 'b3', files: [edited('a.R'), edited('b.R')] };
		await act(async () => engine.fireChange());
		expect(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' })).toBeInTheDocument();

		expect(screen.queryByText(/You changed/)).not.toBeInTheDocument();
	});

	test('a new action starts a new count', async () => {
		engine.state = fakeEngineState({ undo: { ...undoEntry, restoresFiles: true } });
		engine.changes = { basis: 'b1', files: [] };
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' })).toBeInTheDocument();

		// An action finishes, and the files it left behind are the new starting point.
		engine.state = fakeEngineState({ undo: { operationId: 'op-4', description: 'Go back to Tuesday', restoresFiles: true } });
		engine.changes = { basis: 'b2', files: [{ path: 'a.R', status: 'modified', binary: false, sizeBytes: 1, tooLarge: false, hunks: [] }] };
		await act(async () => engine.fireChange());

		expect(await screen.findByRole('button', { name: 'Undo: Go back to Tuesday' })).toBeInTheDocument();
		expect(screen.queryByText(/You changed/)).not.toBeInTheDocument();
	});

	test('stale-operation-id refreshes the state and shows its sentence', async () => {
		engine.state = fakeEngineState({ undo: undoEntry });
		engine.nextResult = { kind: 'unavailable', reason: 'stale-operation-id' };
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		const button = await screen.findByRole('button', { name: 'Undo: Get Maya\'s changes' });
		// Another window finished a newer action, so the state differs when the view reads it again.
		engine.state = fakeEngineState({ undo: { operationId: 'op-9', description: 'Send Changes' } });
		const readsBefore = engine.callsOf('getState').length;

		await user.click(button);

		expect(await screen.findByText('That is no longer the latest action. The view has been refreshed.')).toBeInTheDocument();
		expect(await screen.findByRole('button', { name: 'Undo: Send Changes' })).toBeInTheDocument();
		expect(engine.callsOf('getState').length).toBeGreaterThan(readsBefore);
	});
});
