/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
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
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { keepBothText, proposedName, sanitizeNameLabel } from '../../browser/overlapEditor/overlapChoices.js';
import { OverlapEditorView } from '../../browser/overlapEditor/overlapEditor.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { ICombinationProposal } from '../../common/agent/proposeCombination.js';
import { JobOutcome } from '../../common/agent/jobTypes.js';
import { FakeCheckpointsAgentService } from './fakeAgentService.js';
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
	/** The working files, by path. A file not here cannot be read. */
	const files = new Map<string, string>();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(IWorkingCopyService, { get dirtyWorkingCopies(): IWorkingCopy[] { return []; } })
		.stub(IUriIdentityService, { extUri })
		.stub(IDialogService, {})
		.stub(IFileService, {
			readFile: async (resource: URI) => {
				const text = files.get(resource.path);
				if (text === undefined) {
					throw new Error(`not found: ${resource.path}`);
				}
				return stubInterface<IFileContent>({ value: VSBuffer.fromString(text) });
			},
		})
		.stub(ILanguageService, { guessLanguageIdByFilepathOrFirstLine: (resource: URI) => resource.path.endsWith('.R') ? 'r' : null })
		// The editor service owns the inputs it opens, so the stub hands each one to the test, which disposes it at the end.
		.stub(IEditorService, { openEditor: async (input: EditorInput) => { ctx.disposables.add(input); return undefined; } })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let controller: SyncController;
	let agent: FakeCheckpointsAgentService;

	beforeEach(() => {
		executeCommand.mockClear();
		onClose.mockClear();
		files.clear();
		// Off unless a test turns it on, so only the manual choices show.
		agent = ctx.disposables.add(new FakeCheckpointsAgentService(false));
		ctx.instantiationService.stub(ICheckpointsAgentService, agent);
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		controller = ctx.disposables.add(ctx.instantiationService.createInstance(SyncController));
		ctx.instantiationService.stub(ISyncController, controller);
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

	test('rendering the editor reads the incoming changes and applies nothing', async () => {
		await renderEditor(kinds.map(kind => examples[kind]));

		expect(engine.callsOf('getIncoming')).toEqual([]);
	});

	test('an empty combined text clears the choice unless one version is empty', async () => {
		const user = await renderEditor([{ ...examples.text, base: 'cap <- 450\n' }, overlap('gone', 'text', { path: 'gone.R', base: 'x\n', mine: '', theirs: 'y\n' })]);
		const section = (path: string) => screen.getByRole('region', { name: `Overlap in ${path}` });

		await user.click(within(section('dose.R')).getByRole('radio', { name: 'Keep mine' }));
		await user.clear(within(section('dose.R')).getByRole('textbox', { name: 'Combined text' }));

		expect(controller.resolutions.has('dose')).toBe(false);
		expect(within(section('dose.R')).getByRole('alert')).toHaveTextContent('The combined text is empty.');
		expect(applyButton()).toBeDisabled();

		await user.type(within(section('gone.R')).getByRole('textbox', { name: 'Combined text' }), 'z');
		await user.clear(within(section('gone.R')).getByRole('textbox', { name: 'Combined text' }));

		expect(controller.resolutions.get('gone')).toEqual({ type: 'text', content: '' });
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

	describe('proposed combination', () => {
		const dose = overlap('dose', 'text', { base: 'cap <- 450\nunits <- "mg"\n', mine: 'cap <- 500\nunits <- "mg"\n', theirs: 'cap <- 450\nunits <- "mg/kg"\n' });
		const combined = 'cap <- 500\nunits <- "mg/kg"\n';

		function proposal(confidence: 'high' | 'low'): JobOutcome<ICombinationProposal> {
			return {
				ok: true,
				value: { mineDid: 'raised the cap to 500', theirsDid: 'changed the units to mg/kg', combined, confidence, reason: 'The two changes are on different lines.' },
				fromCache: false,
			};
		}

		test('high confidence preselects the proposal and still needs Apply', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('high'));
			const user = await renderEditor([dose]);

			expect(await screen.findByText('Suggested combination selected. Review it before you apply.')).toBeInTheDocument();
			expect(screen.getByText('You: raised the cap to 500')).toBeInTheDocument();
			expect(screen.getByText('Maya: changed the units to mg/kg')).toBeInTheDocument();
			expect(screen.getByText('Suggested combination').nextSibling).toHaveTextContent('cap <- 500 units <- "mg/kg"');
			expect(screen.getByRole('textbox', { name: 'Combined text' })).toHaveValue(combined);
			expect(screen.queryByRole('radio', { name: 'Keep mine' })).not.toBeInTheDocument();
			expect(controller.resolutions.get('dose')).toEqual({ type: 'text', content: combined });
			expect(engine.callsOf('getIncoming')).toEqual([]);

			await user.click(applyButton());

			await vi.waitFor(() => expect(engine.callsOf('getIncoming')).toEqual([['b1', [{ overlapId: 'dose', choice: { type: 'text', content: combined } }], []]]));
		});

		test('low confidence opens the manual choices with the reason', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('low'));
			const user = await renderEditor([dose]);

			expect(await screen.findByText('This suggestion may not be right, so nothing is selected.')).toBeInTheDocument();
			expect(screen.getByText('The two changes are on different lines.')).toBeInTheDocument();
			expect(screen.getByRole('radio', { name: 'Keep mine' })).not.toBeChecked();
			expect(controller.resolutions.has('dose')).toBe(false);
			expect(applyButton()).toBeDisabled();

			await user.click(screen.getByRole('button', { name: 'Accept' }));

			expect(controller.resolutions.get('dose')).toEqual({ type: 'text', content: combined });
			expect(screen.getByText('Suggested combination selected. Review it before you apply.')).toBeInTheDocument();
			expect(engine.callsOf('getIncoming')).toEqual([]);
		});

		test('Choose myself discards the proposal', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('high'));
			const user = await renderEditor([dose]);
			expect(await screen.findByText('Suggested combination selected. Review it before you apply.')).toBeInTheDocument();

			await user.click(screen.getByRole('button', { name: 'Choose myself' }));

			expect(screen.queryByText('Suggested combination selected. Review it before you apply.')).not.toBeInTheDocument();
			expect(screen.queryByText('You: raised the cap to 500')).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
			expect(controller.resolutions.has('dose')).toBe(false);
			expect(applyButton()).toBeDisabled();
			await user.click(screen.getByRole('radio', { name: 'Keep Maya\'s' }));
			expect(controller.resolutions.get('dose')).toEqual({ type: 'take', side: 'theirs' });
		});

		test('ai off shows only the manual choices', async () => {
			agent.answers.set('propose-combination', proposal('high'));
			await renderEditor([dose]);

			expect(screen.getByRole('radio', { name: 'Keep mine' })).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
			expect(screen.queryByText(/suggest/i)).not.toBeInTheDocument();
			expect(agent.runs).toEqual([]);
			expect(controller.resolutions.size).toBe(0);
		});

		test('while the proposal loads, the manual choices work', async () => {
			agent.setAvailable(true);
			const answer = agent.hold('propose-combination');
			const user = await renderEditor([dose]);

			expect(await screen.findByText('Preparing a suggested combination...')).toBeInTheDocument();
			await user.click(screen.getByRole('radio', { name: 'Keep mine' }));
			expect(controller.resolutions.get('dose')).toEqual({ type: 'take', side: 'mine' });

			answer(proposal('high'));

			expect(await screen.findByText('A suggested combination is ready. Your choice is unchanged.')).toBeInTheDocument();
			expect(screen.getByText('You: raised the cap to 500')).toBeInTheDocument();
			expect(screen.getByRole('radio', { name: 'Keep mine' })).toBeChecked();
			expect(controller.resolutions.get('dose')).toEqual({ type: 'take', side: 'mine' });
		});

		test('a choice made just before a high confidence proposal arrives is kept', async () => {
			agent.setAvailable(true);
			const answer = agent.hold('propose-combination');
			await renderEditor([dose]);
			await vi.waitFor(() => expect(agent.runsOf('propose-combination')).toHaveLength(1));

			controller.setChoice('dose', { type: 'take', side: 'theirs' });
			answer(proposal('high'));

			expect(await screen.findByText('A suggested combination is ready. Your choice is unchanged.')).toBeInTheDocument();
			expect(controller.resolutions.get('dose')).toEqual({ type: 'take', side: 'theirs' });
		});

		test('a low confidence proposal that arrives after a choice keeps the choice and says so', async () => {
			agent.setAvailable(true);
			const answer = agent.hold('propose-combination');
			const user = await renderEditor([dose]);
			await user.click(screen.getByRole('radio', { name: 'Keep Maya\'s' }));

			answer(proposal('low'));

			expect(await screen.findByText('A suggested combination is ready. Your choice is unchanged.')).toBeInTheDocument();
			expect(screen.getByText('The two changes are on different lines.')).toBeInTheDocument();
			expect(screen.queryByText('This suggestion may not be right, so nothing is selected.')).not.toBeInTheDocument();
			expect(controller.resolutions.get('dose')).toEqual({ type: 'take', side: 'theirs' });
		});

		test('editing the result of a preselected proposal shows the manual choices and says so', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('high'));
			const user = await renderEditor([dose]);
			expect(await screen.findByText('Suggested combination selected. Review it before you apply.')).toBeInTheDocument();
			expect(screen.queryByRole('radio', { name: 'Keep mine' })).not.toBeInTheDocument();

			await user.type(screen.getByRole('textbox', { name: 'Combined text' }), '# note');

			expect(screen.getByText('You edited the suggestion.')).toBeInTheDocument();
			expect(screen.queryByText('Suggested combination selected. Review it before you apply.')).not.toBeInTheDocument();
			expect(screen.getByRole('radio', { name: 'Keep mine' })).toBeInTheDocument();
			expect(controller.resolutions.get('dose')).toEqual({ type: 'text', content: `${combined}# note` });
		});

		test('Edit selects the proposal and puts the cursor in the combined text', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('low'));
			const user = await renderEditor([dose]);

			await user.click(await screen.findByRole('button', { name: 'Edit' }));

			expect(controller.resolutions.get('dose')).toEqual({ type: 'text', content: combined });
			expect(screen.getByRole('textbox', { name: 'Combined text' })).toHaveFocus();
		});

		test('the request reads the context from the working file and the language from its name', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('high'));
			files.set('/work/dose-model/dose.R', 'library(ggplot2)\ncap <- 500\nunits <- "mg"\nplot(dose)\n');
			await renderEditor([dose, examples.binary]);

			await vi.waitFor(() => expect(agent.runsOf('propose-combination')).toHaveLength(1));
			expect(agent.runs.map(run => run.input)).toEqual([{ overlap: dose, contextBefore: 'library(ggplot2)\n', contextAfter: 'plot(dose)\n', language: 'r' }]);
		});

		test('a working file that cannot be read gives no context', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('high'));
			await renderEditor([dose]);

			await vi.waitFor(() => expect(agent.runsOf('propose-combination')).toHaveLength(1));
			expect(agent.runs[0].input).toEqual({ overlap: dose, contextBefore: '', contextAfter: '', language: 'r' });
		});

		test('a failed job leaves only the manual choices', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', { ok: false, reason: 'failed-check', detail: 'rejected' });
			await renderEditor([dose]);

			await vi.waitFor(() => expect(agent.runsOf('propose-combination')).toHaveLength(1));
			await vi.waitFor(() => expect(screen.queryByText('Preparing a suggested combination...')).not.toBeInTheDocument());
			expect(screen.getByRole('radio', { name: 'Keep mine' })).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
		});

		test('Back out after a preselected proposal leaves the project unchanged', async () => {
			agent.setAvailable(true);
			agent.answers.set('propose-combination', proposal('high'));
			const user = await renderEditor([dose]);
			expect(await screen.findByText('Suggested combination selected. Review it before you apply.')).toBeInTheDocument();

			await user.click(screen.getByRole('button', { name: 'Back out' }));

			expect(controller.resolutions.size).toBe(0);
			expect(engine.callsOf('getIncoming')).toEqual([]);
			expect(onClose).toHaveBeenCalledTimes(1);
		});
	});

	test('keep both puts mine first and proposes a name beside the original', () => {
		expect(keepBothText('a\n', 'b\n')).toBe('a\nb\n');
		expect(keepBothText('a', 'b')).toBe('a\nb');
		expect(proposedName('figures/plot.png', 'mine')).toBe('figures/plot (mine).png');
		expect(proposedName('.Rprofile', 'mine')).toBe('.Rprofile (mine)');
		expect(proposedName('out', 'Maya')).toBe('out (Maya)');
	});

	test('a proposed name cleans path separators and control characters from the label', () => {
		expect(proposedName('figures/plot.png', '../Ma/ya\\x\n')).toBe('figures/plot (..Mayax).png');
		expect(proposedName('plot.png', '/\u0000')).toBe('plot (copy).png');
	});

	test('a name label loses the characters Windows reserves and direction marks', () => {
		expect(sanitizeNameLabel('M:a*y?a"<b>|c')).toBe('Mayabc');
		expect(sanitizeNameLabel('Ma‮ya⁦‏؜\u0085\u009f')).toBe('Maya');
		expect(sanitizeNameLabel(':*?"<>|‪')).toBe('copy');
		expect(sanitizeNameLabel('Maya Ortiz')).toBe('Maya Ortiz');
	});
});
