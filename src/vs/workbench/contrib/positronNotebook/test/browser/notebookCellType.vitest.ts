/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
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
			// underlying VS Code model -- mirrors ChangeToRawAction's body.
			// Start from a markdown cell so a kind change is required, taking
			// the Replace edit path (which preserves Code kind + raw language)
			// rather than the language-only path that NotebookCellTextModel's
			// language setter can short-circuit on test text models without
			// registered languages.
			const notebook = createTestPositronNotebookInstance(
				[['some text', 'markdown', CellKind.Markup]],
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
});
