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
import { IDialogService, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
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
import { IKeptFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { IProposalController } from '../../browser/proposalController.js';
import { createProposalController } from './proposalTestHelpers.js';
import { FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

const MEGABYTE = 1024 * 1024;

describe('Files kept aside', () => {
	const showSaveDialog = vi.fn<(options: { title?: string; defaultUri?: URI }) => Promise<URI | undefined>>();
	const confirm = vi.fn(async () => ({ confirmed: false }));

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
		.stub(IFileDialogService, { showSaveDialog })
		.stub(IDialogService, { confirm })
		.stub(IFileService, {})
		.stub(IEditorService, {})
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let messageService: CheckpointsMessageService;

	const kept: IKeptFile[] = [
		{ id: 'op-1/data.csv', originalPath: 'data.csv', sizeBytes: MEGABYTE, time: '2026-11-19T10:00:00Z', action: 'Get Maya\'s Changes' },
		{ id: 'op-1/out/model.rds', originalPath: 'out/model.rds', sizeBytes: 2 * MEGABYTE, time: '2026-11-19T10:00:00Z', action: 'Get Maya\'s Changes' },
	];

	beforeEach(() => {
		showSaveDialog.mockReset();
		confirm.mockReset();
		confirm.mockResolvedValue({ confirmed: false });
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		engine.keptFiles = kept;
		engine.state = fakeEngineState({ keptFileCount: kept.length });
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		messageService = ctx.disposables.add(new CheckpointsMessageService());
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, messageService);
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	test('kept files list with total size; Delete asks for confirmation', async () => {
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		const section = await screen.findByRole('region', { name: 'Files kept aside' });
		expect(await within(section).findByText('data.csv')).toBeInTheDocument();
		expect(within(section).getByText('out/model.rds')).toBeInTheDocument();
		expect(within(section).getByText(/^3(\.0+)? ?MB in total\. These files are in no checkpoint\.$/)).toBeInTheDocument();

		await user.click(within(section).getByRole('button', { name: 'Delete: data.csv' }));

		expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
			message: 'Delete data.csv?',
			detail: 'This file is in no checkpoint. After you delete it, it cannot be recovered.',
		}));
		expect(engine.callsOf('deleteKeptFile')).toEqual([]);

		confirm.mockResolvedValue({ confirmed: true });
		await user.click(within(section).getByRole('button', { name: 'Delete: data.csv' }));

		await vi.waitFor(() => expect(engine.callsOf('deleteKeptFile')).toEqual([['op-1/data.csv']]));
	});

	test('a list that cannot be read says so, shows no total, and can be read again', async () => {
		engine.keptFilesError = new Error('engine gone');
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		const section = await screen.findByRole('region', { name: 'Files kept aside' });
		expect(await within(section).findByText('The list of files kept aside could not be read.')).toBeInTheDocument();
		expect(within(section).queryByText(/in total/)).not.toBeInTheDocument();

		engine.keptFilesError = undefined;
		await user.click(within(section).getByRole('button', { name: 'Try Again' }));

		expect(await within(section).findByText('data.csv')).toBeInTheDocument();
		expect(within(section).getByText(/in total/)).toBeInTheDocument();
		expect(within(section).queryByText('The list of files kept aside could not be read.')).not.toBeInTheDocument();
	});

	test('the section is absent when no file is kept', async () => {
		engine.state = fakeEngineState({ keptFileCount: 0 });
		rtl.render(<CheckpointsPanel />);

		expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
		expect(screen.queryByRole('region', { name: 'Files kept aside' })).not.toBeInTheDocument();
	});

	test('Restore returns the file to its original place', async () => {
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Restore: data.csv' }));

		await vi.waitFor(() => expect(engine.callsOf('restoreKeptFile')).toEqual([['op-1/data.csv', undefined]]));
		expect(showSaveDialog).not.toHaveBeenCalled();
	});

	test('Restore on an occupied path asks for a new name', async () => {
		engine.queuedResults = [{ kind: 'unavailable', reason: 'occupied' }];
		showSaveDialog.mockResolvedValue(URI.file('/work/dose-model/data-from-maya.csv'));
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Restore: data.csv' }));

		await vi.waitFor(() => expect(engine.callsOf('restoreKeptFile')).toEqual([
			['op-1/data.csv', undefined],
			['op-1/data.csv', 'data-from-maya.csv'],
		]));
		expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Choose a place for data.csv' }));
	});

	test('cancelling the new name leaves the file aside and says the place is taken', async () => {
		engine.queuedResults = [{ kind: 'unavailable', reason: 'occupied' }];
		showSaveDialog.mockResolvedValue(undefined);
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Restore: data.csv' }));

		expect(await screen.findByText('A file is already in that place. Choose a new name or place for the kept file.')).toBeInTheDocument();
		expect(engine.callsOf('restoreKeptFile')).toHaveLength(1);
	});

	test('Move to another place moves the file to the chosen path in the project', async () => {
		showSaveDialog.mockResolvedValue(URI.file('/work/dose-model/archive/model.rds'));
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Move to Another Place: out/model.rds' }));

		await vi.waitFor(() => expect(engine.callsOf('restoreKeptFile')).toEqual([['op-1/out/model.rds', 'archive/model.rds']]));
	});

	test('a place outside the project is refused and the file stays aside', async () => {
		showSaveDialog.mockResolvedValue(URI.file('/elsewhere/model.rds'));
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Move to Another Place: out/model.rds' }));

		await vi.waitFor(() => expect(messageService.message).toBe('Choose a place inside this project. The file stays aside.'));
		expect(engine.callsOf('restoreKeptFile')).toEqual([]);
	});
});
