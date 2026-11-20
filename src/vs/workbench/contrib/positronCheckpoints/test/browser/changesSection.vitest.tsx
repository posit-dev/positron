/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
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
import { IChangedFile, IChangeSet } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

function changedFile(path: string, overrides: Partial<IChangedFile> = {}): IChangedFile {
	return { path, status: 'modified', binary: false, sizeBytes: 100, tooLarge: false, hunks: [], ...overrides };
}

describe('Changes section and checkpoint dialog', () => {
	let dirty: IWorkingCopy[] = [];
	const onDidChangeDirty = new Emitter<IWorkingCopy>();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWorkingCopyService, {
			get dirtyWorkingCopies() { return dirty; },
			onDidRegister: new Emitter<IWorkingCopy>().event,
			onDidUnregister: new Emitter<IWorkingCopy>().event,
			onDidChangeDirty: onDidChangeDirty.event,
		})
		.stub(IUriIdentityService, { extUri })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.stub(IDialogService, {
			// Presses the first button of the unsaved-editors prompt, which saves the files.
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => ({ result: await prompt.buttons![0].run({ checkboxChecked: false }) }),
		})
		.stub(IFileService, {})
		.stub(IEditorService, {})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let messageService: CheckpointsMessageService;

	beforeEach(() => {
		dirty = [];
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		messageService = ctx.disposables.add(new CheckpointsMessageService());
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, messageService);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup, so one left open
		// would still be there for the next test.
		const cancel = screen.queryByRole('button', { name: 'Cancel' });
		if (cancel) {
			await userEvent.click(cancel);
		}
	});

	function renderPanel(changes: IChangeSet) {
		engine.changes = changes;
		rtl.render(<CheckpointsPanel />);
	}

	async function openDialog() {
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Create checkpoint...' }));
		expect(await screen.findByRole('dialog')).toBeInTheDocument();
		return user;
	}

	/** The button that submits the dialog. */
	function createButton(count: number) {
		return screen.getByRole('button', { name: count === 1 ? 'Create 1 checkpoint' : `Create ${count} checkpoints` });
	}

	test('lists changed files with plain status words', async () => {
		renderPanel({
			basis: 'b1',
			files: [
				changedFile('theme.R'),
				changedFile('import_march.R', { status: 'added' }),
				changedFile('old_plot.R', { status: 'deleted' }),
				changedFile('plot.R', { status: 'renamed', oldPath: 'plot_dose.R' }),
			],
		});

		const rows = await screen.findAllByRole('listitem');

		expect(rows.map(row => row.textContent?.replace(/View detailed differences/, ''))).toEqual([
			'theme.Rchanged',
			'import_march.Rnew',
			'old_plot.Rremoved',
			'plot.Rrenamedwas plot_dose.R',
		]);
		expect(screen.getAllByRole('button', { name: /^View detailed differences: / })).toHaveLength(4);
	});

	test('states the number of unsaved files that are not shown', async () => {
		const unsaved = (path: string) => stubInterface<IWorkingCopy>({ resource: URI.file(path), capabilities: WorkingCopyCapabilities.None });
		dirty = [unsaved('/work/dose-model/a.R'), unsaved('/work/dose-model/b.R'), unsaved('/work/other/c.R')];
		renderPanel({ basis: 'b1', files: [changedFile('theme.R')] });

		expect(await screen.findByText('2 files have unsaved edits that are not shown')).toBeInTheDocument();
	});

	test('with no changes there is no list and the create button is disabled', async () => {
		renderPanel({ basis: 'b1', files: [] });

		expect(await screen.findByText('No changes since your last checkpoint.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create checkpoint...' })).toBeDisabled();
	});

	test('the create button is disabled with an empty or over-long title', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('theme.R')] });
		const user = await openDialog();

		expect(createButton(1)).toBeDisabled();

		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'x'.repeat(73));
		expect(createButton(1)).toBeDisabled();
		expect(screen.getByText('The title can have up to 72 characters.')).toBeInTheDocument();

		await user.type(screen.getByRole('textbox', { name: 'Title' }), '{Backspace}');
		expect(createButton(1)).toBeEnabled();
	});

	test('one chunk with every file submits with the typed title and body', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R'), changedFile('b.R')] });
		const user = await openDialog();

		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Fixed the plot');
		await user.type(screen.getByRole('textbox', { name: 'Description (optional)' }), 'Axis labels');
		await user.click(createButton(1));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			['b1', [{ title: 'Fixed the plot', body: 'Axis labels', hunkIds: [], wholeFiles: ['a.R', 'b.R'] }]],
		]));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	test('two chunks submit in order with the files assigned to each', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R'), changedFile('b.R'), changedFile('c.R')] });
		const user = await openDialog();

		await user.click(screen.getByRole('button', { name: 'Add another checkpoint' }));
		await user.selectOptions(screen.getByRole('combobox', { name: 'Move c.R to' }), 'Checkpoint 2');
		await user.selectOptions(screen.getByRole('combobox', { name: 'Move b.R to' }), 'Checkpoint 2');
		await user.click(screen.getByRole('checkbox', { name: 'b.R' }));
		const titles = screen.getAllByRole('textbox', { name: 'Title' });
		await user.type(titles[0], 'First');
		await user.type(titles[1], 'Second');

		expect(createButton(2)).toBeEnabled();
		await user.click(createButton(2));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			['b1', [
				{ title: 'First', body: '', hunkIds: [], wholeFiles: ['a.R'] },
				{ title: 'Second', body: '', hunkIds: [], wholeFiles: ['c.R'] },
			]],
		]));
	});

	test('a file over 50 MB is unticked and shows the large-file warning', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R'), changedFile('big.csv', { tooLarge: true, sizeBytes: 80 * 1024 * 1024 })] });
		const user = await openDialog();

		const dialog = screen.getByRole('dialog');
		expect(within(dialog).getByRole('checkbox', { name: 'big.csv' })).not.toBeChecked();
		expect(within(dialog).getByRole('checkbox', { name: 'a.R' })).toBeChecked();
		expect(within(dialog).getByText('big.csv is over 50 MB. It is left out of the checkpoint unless you include it.')).toBeInTheDocument();

		await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Code only');
		await user.click(createButton(1));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')[0][1]).toEqual([
			{ title: 'Code only', body: '', hunkIds: [], wholeFiles: ['a.R'] },
		]));
	});

	test('initial chunks open as given', async () => {
		engine.changes = { basis: 'b1', files: [changedFile('a.R'), changedFile('b.R')] };
		const { showCheckpointDialog } = await import('../../browser/components/checkpointDialog.js');
		showCheckpointDialog({
			changes: engine.changes,
			initialChunks: [
				{ title: 'Plot', body: '', hunkIds: [], wholeFiles: ['a.R'] },
				{ title: 'Theme', body: '', hunkIds: [], wholeFiles: ['b.R'] },
			],
		});

		expect(await screen.findByDisplayValue('Plot')).toBeInTheDocument();
		expect(screen.getByDisplayValue('Theme')).toBeInTheDocument();
		expect(createButton(2)).toBeEnabled();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	test('changes-moved shows its sentence and reloads the changes', async () => {
		engine.nextResult = { kind: 'changes-moved' };
		renderPanel({ basis: 'b1', files: [changedFile('a.R')] });
		const user = await openDialog();
		const loadsBefore = engine.callsOf('getChanges').length;

		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Fixed it');
		await user.click(createButton(1));

		expect(await screen.findByText('Your files changed while the checkpoints were being prepared. Nothing was created. Review the changes and try again.')).toBeInTheDocument();
		await vi.waitFor(() => expect(engine.callsOf('getChanges').length).toBeGreaterThan(loadsBefore));
	});

	test('after a save changed the files, the checkpoint uses the current basis and includes the newly saved file', async () => {
		const unsaved = stubInterface<IWorkingCopy>({ resource: URI.file('/work/dose-model/new.R'), capabilities: WorkingCopyCapabilities.None, save: async () => true });
		renderPanel({ basis: 'b1', files: [changedFile('a.R')] });
		const user = await openDialog();
		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'With saved file');
		// The person edits new.R in an editor while the dialog is open; saving it changes the files.
		dirty = [unsaved];
		engine.changes = { basis: 'b2', files: [changedFile('a.R'), changedFile('new.R', { status: 'added' })] };

		await user.click(createButton(1));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			['b2', [{ title: 'With saved file', body: '', hunkIds: [], wholeFiles: ['a.R', 'new.R'] }]],
		]));
	});
});
