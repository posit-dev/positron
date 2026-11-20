/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Emitter } from '../../../../../base/common/event.js';
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
import { UnsavedEditorsDecision } from '../../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { GitDetails } from '../../browser/components/gitDetails.js';
import { fakeCheckpoint, fakeEngineState, FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

const HOUR = 60 * 60 * 1000;

describe('History section', () => {
	let dirty: IWorkingCopy[] = [];
	let prompts: string[] = [];

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
			// Presses the first button of the unsaved-editors prompt, which saves the files.
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => {
				prompts.push(prompt.message);
				return { result: await prompt.buttons![0].run({ checkboxChecked: false }) };
			},
		})
		.stub(IFileService, {})
		.stub(IEditorService, {})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;

	beforeEach(() => {
		dirty = [];
		prompts = [];
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
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

	function renderHistory(history: ICheckpoint[]) {
		engine.history = history;
		rtl.render(<CheckpointsPanel />);
	}

	async function expandRow(title: string) {
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: `Show details of ${title}` }));
		return user;
	}

	const mine = fakeCheckpoint({ id: 'c1', title: 'Mine', shared: false, time: new Date(Date.now() - 2 * HOUR).toISOString() });
	const theirs = fakeCheckpoint({ id: 'c2', title: 'Theirs', authorName: 'Maya', authorIsMe: false, shared: true });

	test('rows show You or the colleague name', async () => {
		renderHistory([mine, theirs]);

		const rows = await screen.findAllByRole('listitem');

		expect(within(rows[0]).getByText('You')).toBeInTheDocument();
		expect(within(rows[0]).getByText(/ago/)).toBeInTheDocument();
		expect(within(rows[1]).getByText('Maya')).toBeInTheDocument();
	});

	test('unshared checkpoints are marked and one Send action is shown', async () => {
		renderHistory([mine, fakeCheckpoint({ id: 'c3', title: 'Also mine', shared: false }), theirs]);
		const user = userEvent.setup();

		expect(await screen.findAllByText('not yet shared')).toHaveLength(2);
		await user.click(screen.getByRole('button', { name: 'Send Changes' }));

		await vi.waitFor(() => expect(engine.callsOf('sendChanges')).toHaveLength(1));
		expect(prompts).toEqual([]);
	});

	test('no Send action is shown when everything is shared', async () => {
		renderHistory([theirs]);

		expect(await screen.findByText('Theirs')).toBeInTheDocument();

		expect(screen.queryByRole('button', { name: 'Send Changes' })).not.toBeInTheDocument();
	});

	test('send rejected shared-copy-moved shows the get-changes-first sentence', async () => {
		engine.nextResult = { kind: 'rejected', reason: 'shared-copy-moved', detail: 'non-fast-forward' };
		renderHistory([mine]);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));

		expect(await screen.findByText('Someone added changes to the shared copy first. Get their changes, then send yours.')).toBeInTheDocument();
	});

	test('send rejected sign-in-required shows the sign-in sentence', async () => {
		engine.nextResult = { kind: 'rejected', reason: 'sign-in-required', detail: 'auth' };
		renderHistory([mine]);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));

		expect(await screen.findByText('Sign in to the service that hosts the shared copy, then try again.')).toBeInTheDocument();
	});

	test('Edit description appears only for unshared checkpoints', async () => {
		renderHistory([mine, theirs]);

		await expandRow('Mine');
		expect(screen.getByRole('button', { name: 'Edit Description' })).toBeInTheDocument();
		await expandRow('Mine');
		await expandRow('Theirs');

		expect(screen.queryByRole('button', { name: 'Edit Description' })).not.toBeInTheDocument();
	});

	test('Edit description saves the trimmed title and body', async () => {
		renderHistory([fakeCheckpoint({ id: 'c1', title: 'Mine', body: 'Old', shared: false })]);
		const user = await expandRow('Mine');

		await user.click(screen.getByRole('button', { name: 'Edit Description' }));
		const title = await screen.findByRole('textbox', { name: 'Title' });
		await user.clear(title);
		await user.type(title, ' New title ');
		await user.click(screen.getByRole('button', { name: 'Save' }));

		await vi.waitFor(() => expect(engine.callsOf('editDescription')).toEqual([['c1', 'New title', 'Old']]));
	});

	test('Edit description cannot be saved with an empty title', async () => {
		renderHistory([mine]);
		const user = await expandRow('Mine');

		await user.click(screen.getByRole('button', { name: 'Edit Description' }));
		await user.clear(await screen.findByRole('textbox', { name: 'Title' }));

		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
	});

	test('Reverse appears only for shared checkpoints', async () => {
		renderHistory([mine, theirs]);

		await expandRow('Theirs');
		expect(screen.getByRole('button', { name: 'Reverse This Checkpoint' })).toBeInTheDocument();
		await expandRow('Theirs');
		await expandRow('Mine');

		expect(screen.queryByRole('button', { name: 'Reverse This Checkpoint' })).not.toBeInTheDocument();
	});

	test('Reverse explains the new checkpoint and runs only after confirmation', async () => {
		renderHistory([theirs]);
		const user = await expandRow('Theirs');

		await user.click(screen.getByRole('button', { name: 'Reverse This Checkpoint' }));
		expect(await screen.findByText(/creates a new checkpoint that makes the opposite change/)).toBeInTheDocument();
		expect(engine.callsOf('reverseCheckpoint')).toEqual([]);
		await user.click(screen.getByRole('button', { name: 'Reverse' }));

		await vi.waitFor(() => expect(engine.callsOf('reverseCheckpoint')).toEqual([['c2']]));
	});

	test('Go back asks to save unsaved files first', async () => {
		dirty = [stubInterface<IWorkingCopy>({ resource: URI.file('/work/dose-model/a.R'), capabilities: WorkingCopyCapabilities.None, save: async () => true })];
		renderHistory([theirs]);
		const user = await expandRow('Theirs');

		await user.click(screen.getByRole('button', { name: 'Go Back to This Checkpoint' }));

		await vi.waitFor(() => expect(engine.callsOf('goBackTo')).toEqual([['c2', []]]));
		expect(prompts).toEqual(['1 file in this project has unsaved edits.']);
	});

	test('a checkpoint with partialFiles shows the partial note', async () => {
		renderHistory([fakeCheckpoint({ id: 'c4', title: 'Part', partialFiles: ['dose.R', 'plot.R'] })]);

		await expandRow('Part');

		expect(screen.getByText('Contains part of the changes to dose.R, plot.R')).toBeInTheDocument();
	});

	test('shows the description of an expanded checkpoint and the git details on request', async () => {
		engine.state = fakeEngineState({ branch: 'main' });
		renderHistory([fakeCheckpoint({ id: 'abc123', title: 'Described', body: 'Fixed the axis' })]);
		const user = await expandRow('Described');

		expect(screen.getByText('Fixed the axis')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Show git details' }));

		const details = screen.getByLabelText('Git details');
		expect(details).toHaveTextContent('Commit idabc123BranchmainUpstreamorigin/main');
	});

	test('loads the next page when the first page is full', async () => {
		const all = Array.from({ length: 60 }, (_, index) => fakeCheckpoint({ id: `c${index}`, title: `Checkpoint ${index}` }));
		renderHistory(all);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Show older checkpoints' }));

		expect(await screen.findByText('Checkpoint 59')).toBeInTheDocument();
		expect(engine.callsOf('getHistory').at(-1)).toEqual([50, 50]);
		expect(screen.queryByRole('button', { name: 'Show older checkpoints' })).not.toBeInTheDocument();
	});

	test('with no checkpoints the section says so', async () => {
		renderHistory([]);

		expect(await screen.findByText(/No checkpoints yet/)).toBeInTheDocument();
	});
});

describe('GitDetails', () => {
	test('leaves out the upstream when there is none', () => {
		const { container } = render(<GitDetails branch='main' commitId='abc' />);

		expect(container).toHaveTextContent(/^Commit idabcBranchmain$/);
	});
});
