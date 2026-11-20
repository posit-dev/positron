/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
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
import { IChangedFile, IChangeSet, IHunk } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { IChunkProposal } from '../../common/agent/splitIntoChunks.js';
import { FakeCheckpointsAgentService } from './fakeAgentService.js';
import { FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

function changedFile(path: string, overrides: Partial<IChangedFile> = {}): IChangedFile {
	return { path, status: 'modified', binary: false, sizeBytes: 100, tooLarge: false, hunks: [], ...overrides };
}

describe('Changes section and checkpoint dialog', () => {
	let dirty: IWorkingCopy[] = [];
	/** The label of the button to press at the unsaved-files prompt, or undefined for Cancel. */
	let pressLabel: string | undefined;
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
			// Presses the button named by `pressLabel`, or Cancel.
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => {
				const button = prompt.buttons?.find(candidate => candidate.label === pressLabel);
				const chosen = button ?? (prompt.cancelButton as { run: () => UnsavedEditorsDecision });
				return { result: await chosen.run({ checkboxChecked: false }) };
			},
		})
		.stub(IFileService, {})
		.stub(IEditorService, {})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let messageService: CheckpointsMessageService;
	let agent: FakeCheckpointsAgentService;

	beforeEach(() => {
		dirty = [];
		pressLabel = 'Save 1 file and include it';
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		messageService = ctx.disposables.add(new CheckpointsMessageService());
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, messageService);
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		// Off unless a test turns it on, so the plain list shows.
		agent = ctx.disposables.add(new FakeCheckpointsAgentService(false));
		ctx.instantiationService.stub(ICheckpointsAgentService, agent);
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

	/** An unsaved file in the project. Saving it empties the list of unsaved files. */
	function unsavedFile(path: string): IWorkingCopy {
		return stubInterface<IWorkingCopy>({
			resource: URI.file(path),
			capabilities: WorkingCopyCapabilities.None,
			save: async () => { dirty = []; return true; },
		});
	}

	test('with no unsaved files and moved files, the engine receives the basis the person reviewed', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R')] });
		const user = await openDialog();
		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Reviewed');
		// Another tool changes the files while the dialog is open.
		engine.changes = { basis: 'b2', files: [changedFile('a.R'), changedFile('other.R', { status: 'added' })] };

		await user.click(createButton(1));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			['b1', [{ title: 'Reviewed', body: '', hunkIds: [], wholeFiles: ['a.R'] }]],
		]));
	});

	test('continuing without the unsaved edits sends the basis of the dialog', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R')] });
		const user = await openDialog();
		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Without edits');
		dirty = [unsavedFile('/work/dose-model/new.R')];
		engine.changes = { basis: 'b2', files: [changedFile('a.R'), changedFile('new.R', { status: 'added' })] };
		pressLabel = 'Continue without the unsaved edits';
		const firstCall = engine.calls.length;

		await user.click(createButton(1));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			['b1', [{ title: 'Without edits', body: '', hunkIds: [], wholeFiles: ['a.R'] }]],
		]));
		// The chunks are not rebuilt, so the changes are not read before the checkpoint is created.
		const methods = engine.calls.slice(firstCall).map(call => call.method);
		expect(methods.slice(0, methods.indexOf('createCheckpoints'))).not.toContain('getChanges');
	});

	test('a save that adds a file shows the dialog again with the file marked, and creates nothing until confirmed', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R')] });
		const user = await openDialog();
		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'With saved file');
		// The person edits new.R in an editor while the dialog is open; saving it changes the files.
		dirty = [unsavedFile('/work/dose-model/new.R')];
		engine.changes = { basis: 'b2', files: [changedFile('a.R'), changedFile('new.R', { status: 'added' })] };

		await user.click(createButton(1));

		const dialog = await screen.findByRole('dialog');
		expect(await within(dialog).findByText('This file was saved and added. Review it, then create the checkpoint again.')).toBeInTheDocument();
		expect(within(dialog).getByText('saved and added')).toBeInTheDocument();
		expect(within(dialog).getByRole('checkbox', { name: 'new.R' })).toBeChecked();
		expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('With saved file');
		expect(engine.callsOf('createCheckpoints')).toEqual([]);

		await user.click(createButton(1));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			['b2', [{ title: 'With saved file', body: '', hunkIds: [], wholeFiles: ['a.R', 'new.R'] }]],
		]));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	test('a save into a new chunk with no title shows the dialog again and never sends an empty title', async () => {
		engine.changes = { basis: 'b1', files: [changedFile('a.R')] };
		const { showCheckpointDialog } = await import('../../browser/components/checkpointDialog.js');
		showCheckpointDialog({
			changes: engine.changes,
			initialChunks: [{ title: '', body: '', hunkIds: [], wholeFiles: [] }, { title: 'Plot', body: '', hunkIds: [], wholeFiles: ['a.R'] }],
		});
		const user = userEvent.setup();
		expect(await screen.findByRole('dialog')).toBeInTheDocument();
		dirty = [unsavedFile('/work/dose-model/new.R')];
		engine.changes = { basis: 'b2', files: [changedFile('a.R'), changedFile('new.R', { status: 'added' })] };

		await user.click(createButton(1));

		expect(await screen.findByText('This file was saved and added. Review it, then create the checkpoint again.')).toBeInTheDocument();
		expect(createButton(2)).toBeDisabled();
		expect(engine.callsOf('createCheckpoints')).toEqual([]);
	});

	test('a save that changes only the content of listed files shows the dialog again, then creates with the new basis', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R')] });
		const user = await openDialog();
		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Saved');
		dirty = [unsavedFile('/work/dose-model/a.R')];
		engine.changes = { basis: 'b2', files: [changedFile('a.R')] };

		await user.click(createButton(1));

		const dialog = await screen.findByRole('dialog');
		expect(await within(dialog).findByText('These files were saved. Review and confirm.')).toBeInTheDocument();
		expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Saved');
		expect(engine.callsOf('createCheckpoints')).toEqual([]);

		await user.click(createButton(1));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			['b2', [{ title: 'Saved', body: '', hunkIds: [], wholeFiles: ['a.R'] }]],
		]));
	});

	test('Cancel at the unsaved-files question keeps the dialog open with the typed text', async () => {
		renderPanel({ basis: 'b1', files: [changedFile('a.R')] });
		const user = await openDialog();
		await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Keep me');
		await user.type(screen.getByRole('textbox', { name: 'Description (optional)' }), 'And me');
		dirty = [unsavedFile('/work/dose-model/a.R')];
		pressLabel = undefined;

		await user.click(createButton(1));

		await vi.waitFor(() => expect(createButton(1)).toBeEnabled());
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Keep me');
		expect(screen.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue('And me');
		expect(engine.callsOf('createCheckpoints')).toEqual([]);
	});

	test('the unsaved count is zero while the project root is not known', async () => {
		dirty = [unsavedFile('/work/dose-model/a.R')];
		const { useUnsavedCount } = await import('../../browser/components/useUnsavedCount.js');
		const Probe = ({ root }: { root: string }) => <span data-testid='count'>{useUnsavedCount(root)}</span>;

		const { rerender } = rtl.render(<Probe root='' />);
		expect(screen.getByTestId('count')).toHaveTextContent('0');

		rerender(<Probe root='/work/dose-model' />);
		await vi.waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
	});

	describe('description by the agent', () => {
		const description = {
			title: 'Fixed the axis labels',
			summary: 'You fixed the axis labels on the dose-response plot.',
			fileNotes: [{ path: 'plot_dose.R', note: 'fixed axis labels' }],
		};
		const twoFiles: IChangeSet = { basis: 'b1', files: [changedFile('plot_dose.R'), changedFile('theme.R')] };

		/** The text of each row of the file list, without its action. */
		async function rowTexts() {
			const rows = await screen.findAllByRole('listitem');
			return rows.map(row => row.textContent?.replace(/View detailed differences/, ''));
		}

		test('the view shows the summary above the files and a note beside a file', async () => {
			agent.setAvailable(true);
			agent.answers.set('describe-changes', { ok: true, value: description, fromCache: false });
			renderPanel(twoFiles);

			expect(await screen.findByText(description.summary)).toBeInTheDocument();
			expect(await rowTexts()).toEqual(['plot_dose.Rchangedfixed axis labels', 'theme.Rchanged']);
			expect(agent.runsOf('describe-changes').map(run => run.input)).toEqual([twoFiles]);
		});

		test('the view shows the file list when the job fails', async () => {
			agent.setAvailable(true);
			agent.answers.set('describe-changes', { ok: false, reason: 'failed-check', detail: 'rejected' });
			renderPanel(twoFiles);

			await vi.waitFor(() => expect(agent.runsOf('describe-changes')).toHaveLength(1));
			expect(await rowTexts()).toEqual(['plot_dose.Rchanged', 'theme.Rchanged']);
			expect(screen.queryByText(description.summary)).not.toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Create checkpoint...' })).toBeEnabled();
		});

		test('while the description loads, the plain list shows and a checkpoint can be created', async () => {
			agent.setAvailable(true);
			const answer = agent.hold('describe-changes');
			renderPanel(twoFiles);

			expect(await rowTexts()).toEqual(['plot_dose.Rchanged', 'theme.Rchanged']);
			const user = await openDialog();
			expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
			await user.click(screen.getByRole('button', { name: 'Cancel' }));

			answer({ ok: true, value: description, fromCache: false });
			expect(await screen.findByText(description.summary)).toBeInTheDocument();
		});

		test('no description is requested while the agent is not available', async () => {
			agent.answers.set('describe-changes', { ok: true, value: description, fromCache: false });
			renderPanel(twoFiles);

			expect(await rowTexts()).toEqual(['plot_dose.Rchanged', 'theme.Rchanged']);
			expect(agent.runs).toEqual([]);

			agent.setAvailable(true);
			expect(await screen.findByText(description.summary)).toBeInTheDocument();

			agent.setAvailable(false);
			await vi.waitFor(() => expect(screen.queryByText(description.summary)).not.toBeInTheDocument());
		});

		test('new changes request a new description and cancel the earlier request', async () => {
			agent.setAvailable(true);
			agent.hold('describe-changes');
			renderPanel(twoFiles);
			await vi.waitFor(() => expect(agent.runsOf('describe-changes')).toHaveLength(1));

			const newer = { title: 'Changed the theme', summary: 'You made the font larger.', fileNotes: [] };
			agent.answers.set('describe-changes', { ok: true, value: newer, fromCache: false });
			engine.changes = { basis: 'b2', files: [changedFile('theme.R')] };
			engine.fireChange();

			expect(await screen.findByText('You made the font larger.')).toBeInTheDocument();
			const runs = agent.runsOf('describe-changes');
			expect(runs.map(run => (run.input as IChangeSet).basis)).toEqual(['b1', 'b2']);
			expect(runs.map(run => run.token.isCancellationRequested)).toEqual([true, false]);
		});

		test('the same changes read again make no new request', async () => {
			agent.setAvailable(true);
			agent.answers.set('describe-changes', { ok: true, value: description, fromCache: false });
			renderPanel(twoFiles);
			expect(await screen.findByText(description.summary)).toBeInTheDocument();

			engine.changes = { ...twoFiles, files: [...twoFiles.files] };
			engine.fireChange();
			await vi.waitFor(() => expect(engine.callsOf('getChanges').length).toBeGreaterThan(1));

			expect(agent.runsOf('describe-changes')).toHaveLength(1);
			expect(screen.getByText(description.summary)).toBeInTheDocument();
		});

		test('no description is requested while the view is hidden', async () => {
			agent.setAvailable(true);
			agent.answers.set('describe-changes', { ok: true, value: description, fromCache: false });
			const visibility = ctx.disposables.add(new Emitter<boolean>());
			const container = stubInterface<IReactComponentContainer>({ containerVisible: false, onVisibilityChanged: visibility.event });
			engine.changes = twoFiles;
			rtl.render(<CheckpointsPanel container={container} />);

			expect(await rowTexts()).toEqual(['plot_dose.Rchanged', 'theme.Rchanged']);
			expect(agent.runs).toEqual([]);

			visibility.fire(true);
			expect(await screen.findByText(description.summary)).toBeInTheDocument();
		});

		test('the dialog starts with the title and summary of the description', async () => {
			agent.setAvailable(true);
			agent.answers.set('describe-changes', { ok: true, value: description, fromCache: false });
			renderPanel(twoFiles);
			expect(await screen.findByText(description.summary)).toBeInTheDocument();

			const user = await openDialog();
			expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(description.title);
			expect(screen.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue(description.summary);
			await user.click(createButton(1));

			await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
				['b1', [{ title: description.title, body: description.summary, hunkIds: [], wholeFiles: ['plot_dose.R', 'theme.R'] }]],
			]));
		});
	});

	describe('split into chunks by the agent', () => {
		function hunk(id: string, added: number): IHunk {
			return { id, header: '@@ -1 +1 @@', addedLines: added, removedLines: 1, patch: `@@ -1 +1 @@\n-old ${id}\n+new ${id}\n` };
		}

		const changes: IChangeSet = {
			basis: 'b1',
			files: [
				changedFile('dose.R', { hunks: [hunk('d1', 1), hunk('d2', 2)] }),
				changedFile('plot.R', { hunks: [hunk('p1', 1)] }),
				changedFile('plot.png', { binary: true }),
			],
		};

		const proposal: IChunkProposal = {
			chunks: [
				{ title: 'Capped the dose', summary: 'You capped the dose at 500 mg.', hunkIds: ['d1'], wholeFiles: ['plot.png'], finished: true },
				{ title: 'Started the units change', summary: 'You began changing units.', hunkIds: ['d2', 'p1'], wholeFiles: [], finished: false },
			],
		};

		/** The chunks of the dialog, in order. */
		function chunkGroups(): HTMLElement[] {
			return within(screen.getByRole('dialog')).getAllByRole('group', { name: /^Checkpoint \d+$/ });
		}

		test('the dialog starts with proposed chunks and ticks the finished ones', async () => {
			agent.setAvailable(true);
			agent.answers.set('split-into-chunks', { ok: true, value: proposal, fromCache: false });
			renderPanel(changes);
			await openDialog();

			expect(await screen.findByDisplayValue('Capped the dose')).toBeInTheDocument();
			const [first, second] = chunkGroups();
			expect(within(first).getByRole('checkbox', { name: 'Checkpoint 1' })).toBeChecked();
			expect(within(second).getByRole('checkbox', { name: 'Checkpoint 2' })).not.toBeChecked();
			expect(within(second).getByDisplayValue('Started the units change')).toBeInTheDocument();
			expect(within(second).getByDisplayValue('You began changing units.')).toBeInTheDocument();
			expect(agent.runsOf('split-into-chunks').map(run => run.input)).toEqual([changes]);

			await userEvent.click(createButton(1));
			await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
				['b1', [{ title: 'Capped the dose', body: 'You capped the dose at 500 mg.', hunkIds: ['d1'], wholeFiles: ['plot.png'] }]],
			]));
		});

		test('a failed job gives one chunk with all files', async () => {
			agent.setAvailable(true);
			agent.answers.set('split-into-chunks', { ok: false, reason: 'failed-check', detail: 'rejected' });
			renderPanel(changes);
			const user = await openDialog();

			await vi.waitFor(() => expect(agent.runsOf('split-into-chunks')).toHaveLength(1));
			expect(chunkGroups()).toHaveLength(1);
			await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Everything');
			await user.click(createButton(1));

			await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
				['b1', [{ title: 'Everything', body: '', hunkIds: [], wholeFiles: ['dose.R', 'plot.R', 'plot.png'] }]],
			]));
		});

		test('the single chunk shows at once and the proposal replaces it only while nothing was changed', async () => {
			agent.setAvailable(true);
			const answer = agent.hold('split-into-chunks');
			renderPanel(changes);
			const user = await openDialog();

			expect(chunkGroups()).toHaveLength(1);
			await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Mine');
			answer({ ok: true, value: proposal, fromCache: false });

			await vi.waitFor(() => expect(agent.runsOf('split-into-chunks')).toHaveLength(1));
			await new Promise(resolve => setTimeout(resolve, 0));
			expect(chunkGroups()).toHaveLength(1);
			expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Mine');
		});

		test('no split is requested with a starting arrangement or while the agent is off', async () => {
			renderPanel(changes);
			const user = await openDialog();
			await user.click(screen.getByRole('button', { name: 'Cancel' }));

			agent.setAvailable(true);
			const { showCheckpointDialog } = await import('../../browser/components/checkpointDialog.js');
			showCheckpointDialog({ changes, initialChunks: [{ title: 'Given', body: '', hunkIds: [], wholeFiles: ['dose.R', 'plot.R', 'plot.png'] }] });
			expect(await screen.findByDisplayValue('Given')).toBeInTheDocument();

			expect(agent.runsOf('split-into-chunks')).toEqual([]);
		});

		test('closing the dialog cancels the request', async () => {
			agent.setAvailable(true);
			agent.hold('split-into-chunks');
			renderPanel(changes);
			const user = await openDialog();
			await vi.waitFor(() => expect(agent.runsOf('split-into-chunks')).toHaveLength(1));

			await user.click(screen.getByRole('button', { name: 'Cancel' }));

			expect(agent.runsOf('split-into-chunks')[0].token.isCancellationRequested).toBe(true);
		});

		test('moving a hunk between chunks updates both chunks', async () => {
			renderPanel(changes);
			const user = await openDialog();
			await user.click(screen.getByRole('button', { name: 'Add another checkpoint' }));

			await user.selectOptions(screen.getByRole('combobox', { name: 'Move part 2 of dose.R to' }), 'Checkpoint 2');

			const [first, second] = chunkGroups();
			const partsOf = (chunk: HTMLElement) => within(within(chunk).getByRole('list', { name: 'dose.R' })).getAllByText(/^Part \d+:/).map(part => part.textContent);
			expect(partsOf(first)).toEqual(['Part 1: 1 lines added, 1 removed']);
			expect(partsOf(second)).toEqual(['Part 2: 2 lines added, 1 removed']);

			const titles = screen.getAllByRole('textbox', { name: 'Title' });
			await user.type(titles[0], 'Cap');
			await user.type(titles[1], 'Units');
			await user.click(createButton(2));
			await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
				['b1', [
					{ title: 'Cap', body: '', hunkIds: ['d1'], wholeFiles: ['plot.R', 'plot.png'] },
					{ title: 'Units', body: '', hunkIds: ['d2'], wholeFiles: [] },
				]],
			]));
		});

		test('a split file shows the partial note', async () => {
			agent.setAvailable(true);
			agent.answers.set('split-into-chunks', { ok: true, value: proposal, fromCache: false });
			renderPanel(changes);
			await openDialog();
			expect(await screen.findByDisplayValue('Capped the dose')).toBeInTheDocument();

			const [first, second] = chunkGroups();
			expect(within(first).getByRole('note')).toHaveTextContent('Contains part of the changes to dose.R');
			expect(within(second).getByRole('note')).toHaveTextContent('Contains part of the changes to dose.R');

			await userEvent.selectOptions(within(second).getByRole('combobox', { name: 'Move dose.R to' }), 'Checkpoint 1');
			expect(screen.queryByRole('note')).not.toBeInTheDocument();
		});

		test('a part shows its text read-only in a block that opens on a click', async () => {
			renderPanel(changes);
			const user = await openDialog();

			const part = within(screen.getByRole('list', { name: 'dose.R' })).getAllByRole('listitem')[0];
			const block = within(part).getByRole('group');
			expect(block).not.toHaveAttribute('open');
			await user.click(within(part).getByText('Part 1: 1 lines added, 1 removed'));

			expect(block).toHaveAttribute('open');
			expect(within(block).getByText(/new d1/)).toHaveTextContent(/^@@ -1 \+1 @@ -old d1 \+new d1$/);
			expect(within(screen.getByRole('dialog')).queryByRole('list', { name: 'plot.R' })).not.toBeInTheDocument();
		});
	});
});
