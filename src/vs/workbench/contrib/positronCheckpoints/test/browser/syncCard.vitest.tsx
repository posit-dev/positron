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
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IIncomingPreview, IPathCollision } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { fakeCheckpoint, FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

const mayaPreview: IIncomingPreview = {
	basis: 'b1',
	incoming: [
		fakeCheckpoint({ id: 'm1', title: 'Updated the dosing table', authorName: 'Maya', authorIsMe: false }),
		fakeCheckpoint({ id: 'm2', title: 'Fixed a typo in the README', authorName: 'Maya', authorIsMe: false }),
	],
	changedPaths: ['dosing.csv', 'README.md'],
	touchesLocalWork: false,
	overlaps: [],
	collisions: [],
};

const collision: IPathCollision = { path: 'data.csv', reason: 'ignored', sizeBytes: 2048, incomingAuthor: 'Maya' };

describe('Sync card and collision dialog', () => {
	const openEditor = vi.fn(async (input: EditorInput) => { ctx.disposables.add(input); return undefined; });

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWorkingCopyService, {
			get dirtyWorkingCopies(): IWorkingCopy[] { return []; },
			onDidRegister: new Emitter<IWorkingCopy>().event,
			onDidUnregister: new Emitter<IWorkingCopy>().event,
			onDidChangeDirty: new Emitter<IWorkingCopy>().event,
		})
		.stub(IUriIdentityService, { extUri })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.stub(IDialogService, {})
		.stub(IFileService, {})
		.stub(IEditorService, { openEditor })
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;

	beforeEach(() => {
		openEditor.mockClear();
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 0, behind: 2 } });
		engine.incoming = mayaPreview;
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const cancel = screen.queryByRole('button', { name: 'Cancel' });
		if (cancel) {
			await userEvent.click(cancel);
		}
	});

	async function renderCard() {
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByText('Maya added 2 checkpoints to the shared copy.')).toBeInTheDocument();
		return userEvent.setup();
	}

	test('the card lists incoming titles and authors', async () => {
		const user = await renderCard();

		const card = screen.getByRole('region', { name: 'Get Changes' });
		expect(within(card).getByText('These changes do not touch your work.')).toBeInTheDocument();
		expect(within(card).getAllByRole('listitem').map(row => row.textContent)).toEqual([
			'Updated the dosing tableMaya',
			'Fixed a typo in the READMEMaya',
		]);
		expect(within(card).getByRole('button', { name: 'Get Maya\'s changes' })).toBeEnabled();
		expect(engine.callsOf('getIncoming')).toEqual([]);

		await user.click(within(card).getByRole('button', { name: 'View detailed differences' }));
		expect(within(card).getAllByRole('button', { name: /^View detailed differences: / }).map(button => button.getAttribute('aria-label'))).toEqual([
			'View detailed differences: dosing.csv',
			'View detailed differences: README.md',
		]);
	});

	test('the card is hidden when nothing is waiting in the shared copy', async () => {
		engine.state = fakeEngineState();
		rtl.render(<CheckpointsPanel />);

		expect(await screen.findByText('You have everything in the shared copy.')).toBeInTheDocument();
		expect(screen.queryByRole('region', { name: 'Get Changes' })).not.toBeInTheDocument();
	});

	test('clean get-changes shows the done sentence and an Undo entry', async () => {
		const user = await renderCard();
		engine.nextResult = { kind: 'done', operationId: 'op-get', hookEditedFiles: [] };
		const statesBefore = engine.callsOf('getState').length;

		await user.click(screen.getByRole('button', { name: 'Get Maya\'s changes' }));

		expect(await screen.findByText('The changes from the shared copy are now in your project.')).toBeInTheDocument();
		expect(engine.callsOf('getIncoming')).toEqual([['b1', [], []]]);
		// The Undo entry is the engine's: the view reloads the state that names it.
		await vi.waitFor(() => expect(engine.callsOf('getState').length).toBeGreaterThan(statesBefore + 1));
		expect(openEditor).not.toHaveBeenCalled();
	});

	test('a collision shows its explanation and Cancel changes nothing', async () => {
		const user = await renderCard();
		engine.nextResult = { kind: 'path-collisions', collisions: [collision] };

		await user.click(screen.getByRole('button', { name: 'Get Maya\'s changes' }));

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('Maya added a file named data.csv. You have your own data.csv that is in no checkpoint.')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled();

		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

		expect(await screen.findByText('Nothing was changed.')).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(engine.callsOf('getIncoming')).toEqual([['b1', [], []]]);
	});

	test('choosing keep-a-copy passes the collision choice to the engine', async () => {
		const user = await renderCard();
		engine.queuedResults = [{ kind: 'path-collisions', collisions: [collision] }];
		engine.nextResult = { kind: 'done', operationId: 'op-get', hookEditedFiles: [] };

		await user.click(screen.getByRole('button', { name: 'Get Maya\'s changes' }));
		const dialog = await screen.findByRole('dialog');
		await user.click(within(dialog).getByRole('checkbox', { name: 'Use theirs and keep a copy of mine' }));
		expect(within(dialog).getByText('A copy of your data.csv is kept aside, and you can restore it later.')).toBeInTheDocument();
		await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

		await vi.waitFor(() => expect(engine.callsOf('getIncoming')).toEqual([
			['b1', [], []],
			['b1', [], [{ path: 'data.csv', choice: 'use-theirs-keep-copy' }]],
		]));
		expect(await screen.findByText('The changes from the shared copy are now in your project.')).toBeInTheDocument();
	});

	test('go back retries with the collision choices', async () => {
		engine.state = fakeEngineState();
		engine.history = [fakeCheckpoint({ id: 'c1', title: 'First version' })];
		engine.queuedResults = [{ kind: 'path-collisions', collisions: [{ path: 'big.bin', reason: 'too-large', sizeBytes: 80 * 1024 * 1024 }] }];
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Show details of First version' }));
		await user.click(screen.getByRole('button', { name: 'Go Back to This Checkpoint' }));
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('This action would replace your file big.bin (80.00MB), which is too large to keep in a checkpoint.')).toBeInTheDocument();
		await user.click(within(dialog).getByRole('checkbox', { name: 'Use theirs and keep a copy of mine' }));
		await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

		await vi.waitFor(() => expect(engine.callsOf('goBackTo')).toEqual([
			['c1', []],
			['c1', [{ path: 'big.bin', choice: 'use-theirs-keep-copy' }]],
		]));
	});
});
