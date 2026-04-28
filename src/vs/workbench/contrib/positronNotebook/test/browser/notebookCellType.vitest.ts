/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { observableValue } from '../../../../../base/common/observable.js';
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

/**
 * Verifies the cell-type conversion API on PositronNotebookInstance.
 *
 * Mirrors the pre-migration e2e (notebook-cell-type.test.ts) which exercised
 * the command-mode keyboard shortcuts for code <-> markdown round-trip,
 * confirming that:
 *  - Cell content is preserved across kind conversions.
 *  - Outputs survive on the underlying text model across a code <-> markdown
 *    <-> code round trip (the e2e watched the output re-render after
 *    converting back to code).
 *
 * The keybinding/wiring path for these actions is left to the upstream
 * registerAction2 plumbing -- their `runNotebookAction` bodies are 1-line
 * calls into changeCellType, which is what the tests here cover.
 *
 * Known coverage gap: the view-layer output re-render across cell-kind
 * changes (cells observable -> rendered output DOM) is asserted by the
 * remaining notebook-cell-output e2e but not at unit level here. The
 * changeCellType branch on the underlying text model is fully covered.
 */
describe('PositronNotebookInstance.changeCellType', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('code <-> markdown conversion', () => {
		it('code -> markdown preserves cell content', () => {
			// Mirrors e2e step "Convert to markdown" + "Verify cell is markdown
			// and content preserved". Active-cell selection drives the conversion.
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
			// Outputs survive a kind change at the model level even though
			// markdown cells do not render outputs. This is what enables the
			// round-trip restoration in the next test.
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
			expect(textModel).toBeDefined();
			expect(textModel!.cells.length).toBe(1);
			expect(textModel!.cells[0].cellKind).toBe(CellKind.Markup);
			expect(textModel!.cells[0].outputs.length).toBe(1);
			expect(textModel!.cells[0].outputs[0].outputId).toBe('test-output');
		});

		it('code -> markdown -> code round-trip restores outputs', () => {
			// Mirrors the full e2e flow: convert to markdown then back to code,
			// content stays intact and the original output is still on the model.
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
			// After the first conversion the cell instance is replaced; reselect
			// the new active cell so the second changeCellType() call resolves it.
			const cellsAfterMarkdown = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterMarkdown[0], CellSelectionType.Normal);
			notebook.changeCellType(CellKind.Code, 'python');

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(1);
			expect(cellsAfter[0].kind).toBe(CellKind.Code);
			expect(cellsAfter[0].getContent()).toBe(code);

			const { textModel } = notebook;
			expect(textModel).toBeDefined();
			expect(textModel!.cells[0].cellKind).toBe(CellKind.Code);
			expect(textModel!.cells[0].language).toBe('python');
			expect(textModel!.cells[0].outputs.length).toBe(1);
			expect(textModel!.cells[0].outputs[0].outputId).toBe('test-output');
		});
	});

	describe('changeCellType edge cases', () => {
		it('is a no-op on an empty notebook', () => {
			// No active cell, no cellToConvert arg -- the method returns early
			// before touching the text model.
			const notebook = createTestPositronNotebookInstance([], ctx);

			expect(() => notebook.changeCellType(CellKind.Markup)).not.toThrow();

			expect(notebook.cells.get().length).toBe(0);
		});

		it('is a no-op when target kind and language match the current cell', () => {
			// Same kind, same language: changeCellType returns before applying
			// any edits. Verify by snapshotting the cell instance identity --
			// an applied edit would replace the cell with a new instance.
			const notebook = createTestPositronNotebookInstance(
				[['code', 'python', CellKind.Code]],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.changeCellType(CellKind.Code, 'python');

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(1);
			// Same instance reference -- proves no Replace edit ran.
			expect(cellsAfter[0]).toBe(cellsBefore[0]);
			expect(cellsAfter[0].getContent()).toBe('code');
		});

		it('changeCellType to raw uses Code kind with raw language', () => {
			// Raw cells are stored as Code cells with language='raw' in the
			// underlying VS Code model -- mirrors ChangeToRawAction's body,
			// which calls notebook.changeCellType(CellKind.Code, 'raw') from a
			// code cell. This exercises the CellEditType.CellLanguage branch
			// (language-only change, kind unchanged).
			//
			// Register 'python' and 'raw' so getLanguageIdByLanguageName()
			// resolves them; otherwise NotebookCellTextModel._setLanguageInternal
			// short-circuits on null and the cell language never updates.
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
			expect(textModel).toBeDefined();
			expect(textModel!.cells.length).toBe(1);
			expect(textModel!.cells[0].cellKind).toBe(CellKind.Code);
			expect(textModel!.cells[0].language).toBe('raw');
			// The notebook-level cell view exposes raw cells via isRawCell().
			expect(notebook.cells.get()[0].isRawCell()).toBe(true);
			// Same instance reference -- proves the CellEditType.CellLanguage
			// path (language-only edit, kind unchanged) ran, not Replace.
			expect(notebook.cells.get()[0]).toBe(cellsBefore[0]);
		});

		it('explicit cellToConvert arg targets a non-active cell', () => {
			// The active cell is index 0, but we pass cell at index 2 explicitly
			// -- only that cell is converted, regardless of the selection state.
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
		// Keybinding-metadata-only tests, matching the Migration 5 pattern in
		// notebookCopyPaste.vitest.ts for similarly-thin actions whose bodies
		// are 1-line passthroughs into changeCellType (already covered by the
		// model-method describes above).

		// Test-only subclass that exposes the protected `runNotebookAction` so
		// we can invoke the action's body without standing up an active editor
		// pane. Same pattern as notebookDelete.vitest.ts.
		class TestableChangeToCodeAction extends ChangeToCodeAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}

		// runNotebookAction takes a ServicesAccessor that this action never reads.
		const unusedAccessor: ServicesAccessor = {
			get() { throw new Error('ServicesAccessor must not be used in this action test'); },
		};

		it('ChangeToCodeAction declares Y scoped to command mode', () => {
			const action = new ChangeToCodeAction();
			expect(action.desc.id).toBe('positronNotebook.cell.changeToCode');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.KeyY);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('ChangeToCodeAction.runNotebookAction passes undefined language when no kernel is attached', () => {
			// Branch coverage: the action derives `kernelLanguage` from
			// `notebook.kernel.get()?.supportedLanguages?.[0]`. With no kernel
			// attached, that resolves to undefined and is forwarded to
			// changeCellType as the language argument.
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
			expect(action.desc.keybinding?.primary).toBe(KeyCode.KeyM);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('ChangeToRawAction declares R scoped to command mode', () => {
			const action = new ChangeToRawAction();
			expect(action.desc.id).toBe('positronNotebook.cell.changeToRaw');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.KeyR);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});
	});
});
