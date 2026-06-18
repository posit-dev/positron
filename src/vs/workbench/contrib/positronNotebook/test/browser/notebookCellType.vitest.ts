/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { assertDefined } from '../../../../../base/common/types.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { RuntimeNotebookKernel } from '../../../runtimeNotebookKernel/browser/runtimeNotebookKernel.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import {
	ChangeToCodeAction,
	ChangeToMarkdownAction,
	ChangeToRawAction,
	POSITRON_NOTEBOOK_COMMAND_MODE,
} from '../../browser/positronNotebook.contribution.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';
import { singleKeybinding } from './keybindingTestUtils.js';

// View-layer output re-render across cell-kind changes is covered by the
// notebook-cell-output e2e; this file covers the model-level changeCellType.
describe('PositronNotebookInstance.changeCellType', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('code <-> markdown conversion', () => {
		it('code -> markdown preserves cell content', () => {
			const code = 'print("hello")';
			const notebook = createTestPositronNotebookInstance(
				[[code, 'python', CellKind.Code]],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.changeCellType(CellKind.Markup);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(1);
			expect(cellsAfter[0].kind).toBe(CellKind.Markup);
			expect(cellsAfter[0].getContent()).toBe(code);
		});

		it('code -> markdown preserves outputs on the underlying text model', () => {
			// Markdown cells don't render outputs, but outputs persist on the
			// text model so a round-trip back to code can restore them.
			const code = 'print("hello")';
			const notebook = createTestPositronNotebookInstance(
				[[code, 'python', CellKind.Code, [{
					outputId: 'test-output',
					outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('hello') }],
				}]]],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.changeCellType(CellKind.Markup);

			const { textModel } = notebook;
			assertDefined(textModel, 'textModel');
			expect(textModel.cells.length).toBe(1);
			expect(textModel.cells[0].cellKind).toBe(CellKind.Markup);
			expect(textModel.cells[0].outputs.length).toBe(1);
			expect(textModel.cells[0].outputs[0].outputId).toBe('test-output');
		});

		it('code -> markdown -> code round-trip restores outputs', () => {
			const code = 'print("hello")';
			const notebook = createTestPositronNotebookInstance(
				[[code, 'python', CellKind.Code, [{
					outputId: 'test-output',
					outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('hello') }],
				}]]],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.changeCellType(CellKind.Markup);
			// Conversion replaces the cell instance, so reselect before the
			// second changeCellType() can resolve an active cell.
			const cellsAfterMarkdown = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterMarkdown[0], CellSelectionType.Normal);
			notebook.changeCellType(CellKind.Code, 'python');

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(1);
			expect(cellsAfter[0].kind).toBe(CellKind.Code);
			expect(cellsAfter[0].getContent()).toBe(code);

			const { textModel } = notebook;
			assertDefined(textModel, 'textModel');
			expect(textModel.cells[0].cellKind).toBe(CellKind.Code);
			expect(textModel.cells[0].language).toBe('python');
			expect(textModel.cells[0].outputs.length).toBe(1);
			expect(textModel.cells[0].outputs[0].outputId).toBe('test-output');
		});
	});

	describe('changeCellType edge cases', () => {
		it('is a no-op on an empty notebook', () => {
			const notebook = createTestPositronNotebookInstance([], ctx);

			expect(() => notebook.changeCellType(CellKind.Markup)).not.toThrow();

			expect(notebook.cells.get().length).toBe(0);
		});

		it('is a no-op when target kind and language match the current cell', () => {
			// Asserted via instance identity below: an applied Replace edit
			// would swap in a new cell instance.
			const notebook = createTestPositronNotebookInstance(
				[['code', 'python', CellKind.Code]],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.changeCellType(CellKind.Code, 'python');

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(1);
			expect(cellsAfter[0]).toBe(cellsBefore[0]);
			expect(cellsAfter[0].getContent()).toBe('code');
		});

		it('changeCellType to raw uses Code kind with raw language', () => {
			// Raw cells are stored as Code cells with language='raw' -- this
			// exercises the CellEditType.CellLanguage branch (language-only
			// edit, kind unchanged).
			//
			// 'python' and 'raw' must be registered with the language service
			// or NotebookCellTextModel._setLanguageInternal short-circuits on
			// null and the cell language never updates.
			const languageService = ctx.get(ILanguageService);
			ctx.disposables.add(languageService.registerLanguage({ id: 'python', aliases: ['python'] }));
			ctx.disposables.add(languageService.registerLanguage({ id: 'raw', aliases: ['raw'] }));

			const notebook = createTestPositronNotebookInstance(
				[['some text', 'python', CellKind.Code]],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.changeCellType(CellKind.Code, 'raw');

			const { textModel } = notebook;
			assertDefined(textModel, 'textModel');
			expect(textModel.cells.length).toBe(1);
			expect(textModel.cells[0].cellKind).toBe(CellKind.Code);
			expect(textModel.cells[0].language).toBe('raw');
			expect(notebook.cells.get()[0].isRawCell()).toBe(true);
			// Same instance reference proves the CellLanguage path ran (not
			// Replace, which would swap the cell instance).
			expect(notebook.cells.get()[0]).toBe(cellsBefore[0]);
		});

		it('explicit cellToConvert arg targets a non-active cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['cell0', 'python', CellKind.Code],
					['cell1', 'python', CellKind.Code],
					['cell2', 'python', CellKind.Code],
				],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.changeCellType(CellKind.Markup, undefined, cellsBefore[2]);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(3);
			expect(cellsAfter[0].kind).toBe(CellKind.Code);
			expect(cellsAfter[1].kind).toBe(CellKind.Code);
			expect(cellsAfter[2].kind).toBe(CellKind.Markup);
			expect(cellsAfter[2].getContent()).toBe('cell2');
		});
	});

	describe('Action wiring (cell-type keybindings)', () => {
		// Test-only subclass exposes the protected `runNotebookAction` so we can
		// invoke the action body without standing up an active editor pane.
		class TestableChangeToCodeAction extends ChangeToCodeAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}

		const unusedAccessor: ServicesAccessor = {
			get() { throw new Error('ServicesAccessor must not be used in this action test'); },
		};

		it('ChangeToCodeAction declares Y scoped to command mode', () => {
			const action = new ChangeToCodeAction();
			expect(action.desc.id).toBe('positronNotebook.cell.changeToCode');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.KeyY);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('ChangeToCodeAction.runNotebookAction passes undefined language when no kernel is attached', () => {
			const changeCellType = vi.fn();
			const notebook = stubInterface<IPositronNotebookInstance>({
				kernel: observableValue<RuntimeNotebookKernel | undefined>('kernel', undefined),
				changeCellType,
			});

			new TestableChangeToCodeAction().testRun(notebook, unusedAccessor);

			expect(changeCellType).toHaveBeenCalledWith(CellKind.Code, undefined);
		});

		it('ChangeToMarkdownAction declares M scoped to command mode', () => {
			const action = new ChangeToMarkdownAction();
			expect(action.desc.id).toBe('positronNotebook.cell.changeToMarkdown');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.KeyM);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('ChangeToRawAction declares R scoped to command mode', () => {
			const action = new ChangeToRawAction();
			expect(action.desc.id).toBe('positronNotebook.cell.changeToRaw');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.KeyR);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});
	});
});
