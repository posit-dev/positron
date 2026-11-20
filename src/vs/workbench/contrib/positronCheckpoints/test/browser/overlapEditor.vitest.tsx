/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
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
import { IOverlap, OverlapKind } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { keepBothText, proposedName } from '../../browser/overlapEditor/overlapChoices.js';
import { OverlapEditorView } from '../../browser/overlapEditor/overlapEditor.js';
import { SyncController } from '../../browser/syncController.js';
import { FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

function overlap(id: string, kind: OverlapKind, overrides: Partial<IOverlap> = {}): IOverlap {
	return { id, kind, path: `${id}.R`, otherPaths: [], theirAuthor: 'Maya', detail: '', ...overrides };
}

const examples: Record<OverlapKind, IOverlap> = {
	'text': overlap('dose', 'text', { mine: 'cap <- 500\n', theirs: 'cap <- 400\n' }),
	'binary': overlap('plot', 'binary', { path: 'figures/plot.png', mineSizeBytes: 1024, theirsSizeBytes: 2048 }),
	'edit-delete': overlap('old', 'edit-delete', { deletedBy: 'them' }),
	'rename': overlap('model', 'rename', { path: 'model.R', otherPaths: ['dose_model.R', 'fit.R'] }),
	'file-folder': overlap('out', 'file-folder', { path: 'out', mineSizeBytes: 10 }),
	'unsupported': overlap('sub', 'unsupported', { path: 'vendor/lib' }),
};

/** The labels of the choices each kind offers, in order. */
const expectedChoices: Record<OverlapKind, string[]> = {
	'text': ['Keep mine', 'Keep Maya\'s', 'Keep both'],
	'binary': ['Keep mine', 'Keep Maya\'s', 'Keep both'],
	'edit-delete': ['Keep the edited file', 'Accept the deletion'],
	'rename': ['Keep the name model.R', 'Keep the name dose_model.R', 'Keep the name fit.R'],
	'file-folder': ['Keep mine', 'Keep Maya\'s', 'Keep both'],
	'unsupported': [],
};

const kinds = Object.keys(examples) as OverlapKind[];

describe('Overlap editor', () => {
	const executeCommand = vi.fn(async () => undefined);
	const onClose = vi.fn();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(IWorkingCopyService, { get dirtyWorkingCopies(): IWorkingCopy[] { return []; } })
		.stub(IUriIdentityService, { extUri })
		.stub(IDialogService, {})
		// The editor service owns the inputs it opens, so the stub disposes each one.
		.stub(IEditorService, { openEditor: async (input: EditorInput) => { input.dispose(); return undefined; } })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let controller: SyncController;

	beforeEach(() => {
		executeCommand.mockClear();
		onClose.mockClear();
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		controller = ctx.disposables.add(ctx.instantiationService.createInstance(SyncController));
	});

	async function renderEditor(overlaps: IOverlap[]) {
		engine.incoming = { basis: 'b1', incoming: [], changedPaths: overlaps.map(o => o.path), touchesLocalWork: true, overlaps, collisions: [] };
		await controller.refreshPreview();
		rtl.render(<OverlapEditorView controller={controller} onClose={onClose} />);
		return userEvent.setup();
	}

	function applyButton() {
		return screen.getByRole('button', { name: 'Apply Choices' });
	}

	test.each(kinds)('%s overlap offers exactly its allowed choices', async kind => {
		await renderEditor([examples[kind]]);

		const section = screen.getByRole('region', { name: `Overlap in ${examples[kind].path}` });
		expect(within(section).queryAllByRole('radio').map(radio => radio.closest('label')?.textContent)).toEqual(expectedChoices[kind]);
	});

	test('choosing in each kind sends the choice the engine expects', async () => {
		const user = await renderEditor(kinds.filter(kind => kind !== 'unsupported').map(kind => examples[kind]));
		const section = (path: string) => screen.getByRole('region', { name: `Overlap in ${path}` });

		await user.click(within(section('dose.R')).getByRole('radio', { name: 'Keep both' }));
		await user.click(within(section('figures/plot.png')).getByRole('radio', { name: 'Keep both' }));
		await user.click(within(section('old.R')).getByRole('radio', { name: 'Accept the deletion' }));
		await user.click(within(section('model.R')).getByRole('radio', { name: 'Keep the name fit.R' }));
		await user.click(within(section('out')).getByRole('radio', { name: 'Keep Maya\'s' }));

		expect(Object.fromEntries(controller.resolutions)).toEqual({
			'dose': { type: 'text', content: 'cap <- 500\ncap <- 400\n' },
			'plot': { type: 'keep-both', renamedSide: 'mine', newPath: 'figures/plot (mine).png' },
			'old': { type: 'accept-deletion' },
			'model': { type: 'path', keepPath: 'fit.R' },
			'out': { type: 'take', side: 'theirs' },
		});
		expect(within(section('figures/plot.png')).getByText('Yours: 1.00KB. Maya\'s: 2.00KB.')).toBeInTheDocument();
	});

	test('a text overlap shows both sides, and the result can be edited', async () => {
		const user = await renderEditor([examples.text]);

		expect(screen.getByText('Mine').nextSibling).toHaveTextContent('cap <- 500');
		expect(screen.getByText('Maya\'s').nextSibling).toHaveTextContent('cap <- 400');
		await user.click(screen.getByRole('radio', { name: 'Keep mine' }));
		const result = screen.getByRole('textbox', { name: 'Combined text' });
		expect(result).toHaveValue('cap <- 500\n');

		await user.clear(result);
		await user.type(result, 'cap <- 450');

		expect(controller.resolutions.get('dose')).toEqual({ type: 'text', content: 'cap <- 450' });
		expect(screen.getByRole('radio', { name: 'Keep mine' })).not.toBeChecked();
	});

	test('a new name equal to the old one clears the keep-both choice', async () => {
		const user = await renderEditor([examples.binary]);

		await user.click(screen.getByRole('radio', { name: 'Keep both' }));
		const name = screen.getByRole('textbox', { name: /New name for figures\/plot.png/ });
		await user.clear(name);
		await user.type(name, 'figures/plot.png');

		expect(controller.resolutions.has('plot')).toBe(false);
		expect(screen.getByRole('alert')).toHaveTextContent('Choose a new name that differs from figures/plot.png.');
		expect(applyButton()).toBeDisabled();
	});

	test('Apply is disabled until every overlap has a choice', async () => {
		const user = await renderEditor([examples.text, examples['edit-delete']]);

		expect(applyButton()).toBeDisabled();
		await user.click(screen.getByRole('radio', { name: 'Keep Maya\'s' }));
		expect(applyButton()).toBeDisabled();
		await user.click(screen.getByRole('radio', { name: 'Keep the edited file' }));
		expect(applyButton()).toBeEnabled();

		await user.click(applyButton());

		await vi.waitFor(() => expect(engine.callsOf('getIncoming')).toEqual([['b1', [
			{ overlapId: 'dose', choice: { type: 'take', side: 'theirs' } },
			{ overlapId: 'old', choice: { type: 'keep-file' } },
		], []]]));
		await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
	});

	test('an unsupported overlap disables Apply and links to Source Control', async () => {
		const user = await renderEditor([examples.text, examples.unsupported]);

		await user.click(screen.getByRole('radio', { name: 'Keep mine' }));
		expect(screen.getByText('This needs a git tool')).toBeInTheDocument();
		expect(applyButton()).toBeDisabled();

		await user.click(screen.getByRole('button', { name: 'Open Source Control' }));
		expect(executeCommand).toHaveBeenCalledWith('workbench.view.scm');
	});

	test('inputs-changed is named in the editor and the new overlaps are shown', async () => {
		const user = await renderEditor([examples.text]);
		await user.click(screen.getByRole('radio', { name: 'Keep mine' }));
		engine.nextResult = { kind: 'inputs-changed', changed: ['files'], preview: { ...controller.preview!, basis: 'b2', overlaps: [examples.text, examples['edit-delete']] } };

		await user.click(applyButton());

		expect(await screen.findByText('One of the overlapping files changed since you reviewed this. The changes are shown again. Nothing was changed.')).toBeInTheDocument();
		expect(screen.getByRole('region', { name: 'Overlap in old.R' })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Keep mine' })).toBeChecked();
		expect(onClose).not.toHaveBeenCalled();
	});

	test('Back out leaves the project unchanged', async () => {
		const user = await renderEditor([examples.text]);
		await user.click(screen.getByRole('radio', { name: 'Keep mine' }));

		await user.click(screen.getByRole('button', { name: 'Back out' }));

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(controller.resolutions.size).toBe(0);
		expect(engine.callsOf('getIncoming')).toEqual([]);
	});

	test('keep both puts mine first and proposes a name beside the original', () => {
		expect(keepBothText('a\n', 'b\n')).toBe('a\nb\n');
		expect(keepBothText('a', 'b')).toBe('a\nb');
		expect(proposedName('figures/plot.png', 'mine')).toBe('figures/plot (mine).png');
		expect(proposedName('.Rprofile', 'mine')).toBe('.Rprofile (mine)');
		expect(proposedName('out', 'Maya')).toBe('out (Maya)');
	});
});
