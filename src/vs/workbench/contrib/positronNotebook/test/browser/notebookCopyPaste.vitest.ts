/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { TestClipboardService } from '../../../../../platform/clipboard/test/common/testClipboardService.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import {
	CopyCellsAction,
	CutCellsAction,
	PasteCellsAboveAction,
	PasteCellsAction,
	POSITRON_NOTEBOOK_COMMAND_MODE,
} from '../../browser/positronNotebook.contribution.js';
import { IPositronNotebookService } from '../../browser/positronNotebookService.js';
import {
	CellSelectionType,
	getActiveCell,
} from '../../browser/selectionMachine.js';
import {
	createLabelledTestNotebook,
	createTestPositronNotebookInstance,
} from './testPositronNotebookInstance.js';

/**
 * Verifies the copy/cut/paste API on PositronNotebookInstance and the
 * keyboard-binding wiring that drives it.
 *
 * Mirrors the pre-migration e2e (notebook-copy-paste.test.ts) which exercised:
 *  - Copy a single cell, paste at a later index.
 *  - Cut a single cell, paste at a different index.
 *  - Clipboard persistence: copy once, paste multiple times.
 *  - Cut and paste at the beginning of a notebook.
 *  - Multiselect cut from the top + paste at the bottom.
 *
 * The action keybinding describe block at the bottom replaces the e2e's
 * keyboard-shortcut path (the e2e drove the action bar via performCellAction,
 * but the keybindings themselves were not asserted at any level).
 */
describe('PositronNotebookInstance.copy/cut/paste*', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		.stub(IClipboardService, new TestClipboardService())
		.build();

	describe('copyCells', () => {
		it('copies the given cell into the notebook-service clipboard and writes its content to the system clipboard', () => {
			// Mirrors e2e Test 1 setup: copying a single code cell stores a DTO
			// for within-window paste AND writes the cell text to the system
			// clipboard so other editors can paste it as plain text.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			], ctx);
			const cells = notebook.cells.get();
			const writeTextSpy = vi.spyOn(ctx.get(IClipboardService), 'writeText');

			notebook.copyCells([cells[2]]);

			const clipboardCells = ctx.get(IPositronNotebookService).getClipboardCells();
			expect(clipboardCells.length).toBe(1);
			expect(clipboardCells[0].source).toBe('# Cell 2');
			expect(clipboardCells[0].cellKind).toBe(CellKind.Code);
			expect(writeTextSpy).toHaveBeenCalledTimes(1);
			expect(writeTextSpy).toHaveBeenCalledWith('# Cell 2');
		});

		it('preserves outputs on the clipboard DTO', () => {
			// Outputs ride along on the clipboard DTO so that pasting restores
			// the cell with its prior output state.
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code, [{
					outputId: 'test-output',
					outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('hello') }],
				}]]],
				ctx,
			);
			const cells = notebook.cells.get();

			notebook.copyCells([cells[0]]);

			const clipboardCells = ctx.get(IPositronNotebookService).getClipboardCells();
			expect(clipboardCells.length).toBe(1);
			expect(clipboardCells[0].outputs.length).toBe(1);
			expect(clipboardCells[0].outputs[0].outputId).toBe('test-output');
		});

		it('copyCells() with no argument copies the currently selected cells', () => {
			// Default-arg branch: omitting the cells argument falls back to
			// getSelectedCells(state) so copying after a Normal selection still
			// works without callers having to plumb the active cell through.
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);

			notebook.copyCells();

			const clipboardCells = ctx.get(IPositronNotebookService).getClipboardCells();
			expect(clipboardCells.length).toBe(1);
			expect(clipboardCells[0].source).toBe(cells[1].getContent());
		});

		it('copyCells() is a no-op with empty selection', () => {
			// Guard: nothing to copy, no argument -- the method returns early
			// and never touches either clipboard. An empty notebook is the only
			// way to reach the NoCells selection state where getSelectedCells()
			// returns []; populated notebooks auto-select cell 0.
			const notebook = createTestPositronNotebookInstance([], ctx);
			const writeTextSpy = vi.spyOn(ctx.get(IClipboardService), 'writeText');
			ctx.get(IPositronNotebookService).clearClipboard();

			expect(() => notebook.copyCells()).not.toThrow();

			expect(ctx.get(IPositronNotebookService).hasClipboardCells()).toBe(false);
			expect(writeTextSpy).not.toHaveBeenCalled();
		});
	});

	describe('pasteCells', () => {
		it('copy index 2 then paste with active index 4 inserts at index 5', () => {
			// Mirrors e2e Test 1, sub-step a: 5-cell notebook, copy index 2,
			// active cell at index 4, paste -- inserts after the active cell so
			// index 5 holds a duplicate of index 2.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
				['# Cell 3', 'python', CellKind.Code],
				['# Cell 4', 'python', CellKind.Code],
			], ctx);
			const cellsBefore = notebook.cells.get();
			notebook.copyCells([cellsBefore[2]]);
			notebook.selectionStateMachine.selectCell(cellsBefore[4], CellSelectionType.Normal);

			notebook.pasteCells();

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(6);
			expect(cellsAfter.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell 2',
				'# Cell 3',
				'# Cell 4',
				'# Cell 2',
			]);
		});

		it('clipboard persists across multiple pastes from a single copy', () => {
			// Mirrors e2e Test 1, sub-step c: copying once and pasting twice at
			// different positions duplicates the cell into both spots (the
			// notebook-service clipboard is not cleared by paste). The explicit
			// index argument is the insert position itself.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			], ctx);
			const cellsBefore = notebook.cells.get();
			notebook.copyCells([cellsBefore[0]]);

			// First paste at index 2 -> inserts AT index 2 (the existing cell
			// at 2 shifts down).
			notebook.pasteCells(2);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell 0',
				'# Cell 2',
			]);

			// Second paste at index 4 -> inserts AT index 4 (end). The
			// clipboard still holds the original cell.
			notebook.pasteCells(4);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell 0',
				'# Cell 2',
				'# Cell 0',
			]);
		});

		it('pasteCells(explicitIndex) inserts at the given index', () => {
			// Explicit-index branch: passing an index bypasses the active-cell
			// fallback in getInsertionIndex(), inserting precisely at the index
			// regardless of selection state.
			const notebook = createLabelledTestNotebook(3, ctx);
			const cellsBefore = notebook.cells.get();
			notebook.copyCells([cellsBefore[2]]);
			// Ensure no active cell so getInsertionIndex() would otherwise pick
			// the end -- we want to verify the explicit-index path takes precedence.
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.pasteCells(0);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(4);
			expect(cellsAfter[0].getContent()).toBe(cellsBefore[2].getContent());
		});

		it('pasteCells() is a no-op when the clipboard is empty', () => {
			// canPaste() guard: with no clipboard cells, paste returns early and
			// the notebook stays untouched.
			const notebook = createLabelledTestNotebook(3, ctx);
			ctx.get(IPositronNotebookService).clearClipboard();
			const before = notebook.cells.get().map(c => c.getContent());

			expect(() => notebook.pasteCells()).not.toThrow();

			expect(notebook.cells.get().map(c => c.getContent())).toEqual(before);
		});
	});

	describe('cutCells', () => {
		it('cut + paste-elsewhere moves the cell to the new position', () => {
			// Mirrors e2e Test 1, sub-step b: cut "# Cell 1" from index 1, paste
			// after index 3 (now index 2 since the cut shifted indices). The
			// cell ends up at the new position; the notebook size is restored.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
				['# Cell 3', 'python', CellKind.Code],
			], ctx);
			const cellsBefore = notebook.cells.get();

			notebook.cutCells([cellsBefore[1]]);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 2',
				'# Cell 3',
			]);

			// Paste after index 2 -> insert at index 3 (end of the 3-cell notebook).
			const cellsAfterCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterCut[2], CellSelectionType.Normal);
			notebook.pasteCells();

			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 2',
				'# Cell 3',
				'# Cell 1',
			]);
		});

		it('cutCells() with no argument cuts the currently selected cells', () => {
			// Default-arg branch mirrors copyCells(): falls back to the active
			// selection so keyboard-driven cut works without an explicit cell arg.
			const notebook = createLabelledTestNotebook(3, ctx);
			const cellsBefore = notebook.cells.get();
			const targetContent = cellsBefore[1].getContent();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);

			notebook.cutCells();

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(2);
			expect(cellsAfter.map(c => c.getContent())).not.toContain(targetContent);
			// And the cut cell is sitting on the clipboard ready to paste.
			const clipboardCells = ctx.get(IPositronNotebookService).getClipboardCells();
			expect(clipboardCells.length).toBe(1);
			expect(clipboardCells[0].source).toBe(targetContent);
		});

		it('cutCells() is a no-op with empty selection', () => {
			// Guard: nothing to cut, no argument -- the method returns before
			// touching either the notebook or the clipboard. An empty notebook
			// is the only way to reach the NoCells selection state.
			const notebook = createTestPositronNotebookInstance([], ctx);
			ctx.get(IPositronNotebookService).clearClipboard();

			expect(() => notebook.cutCells()).not.toThrow();

			expect(notebook.cells.get().length).toBe(0);
			expect(ctx.get(IPositronNotebookService).hasClipboardCells()).toBe(false);
		});
	});

	describe('pasteCellsAbove', () => {
		it('inserts at the active cell index (above, not below)', () => {
			// pasteCellsAbove is the Shift+V counterpart -- it passes the active
			// cell's own index to pasteCells, so the new cell takes that index
			// and the previously-active cell shifts down.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			], ctx);
			const cellsBefore = notebook.cells.get();
			notebook.copyCells([cellsBefore[2]]);
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);

			notebook.pasteCellsAbove();

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(4);
			expect(cellsAfter.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 2',
				'# Cell 1',
				'# Cell 2',
			]);
		});

		it('with no active cell falls back to index 0', () => {
			// Branch coverage: pasteCellsAbove() pastes at 0 when getActiveCell()
			// returns null. The only way to hit that branch is the NoCells state
			// (an empty notebook), so we copy from a populated source notebook
			// and paste into an empty target -- the notebook-service clipboard
			// is process-wide, so the cells flow across instances.
			const source = createLabelledTestNotebook(3, ctx);
			const target = createTestPositronNotebookInstance([], ctx);
			const sourceCells = source.cells.get();
			source.copyCells([sourceCells[2]]);
			expect(getActiveCell(target.selectionStateMachine.state.get())).toBeNull();

			target.pasteCellsAbove();

			const cellsAfter = target.cells.get();
			expect(cellsAfter.length).toBe(1);
			expect(cellsAfter[0].getContent()).toBe(sourceCells[2].getContent());
		});
	});

	describe('Multi-cell copy/cut/paste', () => {
		it('multiselect cut at top + paste at bottom preserves cell kinds and ordering', () => {
			// Mirrors e2e Test 2: 5-cell notebook (2 code + 3 markdown), cut
			// indices 0-2 (mixed code+markdown), then paste below the new last
			// cell. Final order matches the e2e: ### Cell 3, ### Cell 4,
			// # Cell 0, # Cell 1, ### Cell 2 -- confirming both the cut path
			// preserves kind and the paste path preserves order.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['### Cell 2', 'markdown', CellKind.Markup],
				['### Cell 3', 'markdown', CellKind.Markup],
				['### Cell 4', 'markdown', CellKind.Markup],
			], ctx);
			const cellsBefore = notebook.cells.get();
			const toCut = [cellsBefore[0], cellsBefore[1], cellsBefore[2]];
			notebook.selectionStateMachine.selectCell(toCut[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(toCut[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(toCut[2], CellSelectionType.Add);

			notebook.cutCells();
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'### Cell 3',
				'### Cell 4',
			]);

			// Select the new last cell (### Cell 4) and paste below.
			const cellsAfterCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterCut[1], CellSelectionType.Normal);
			notebook.pasteCells();

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.map(c => c.getContent())).toEqual([
				'### Cell 3',
				'### Cell 4',
				'# Cell 0',
				'# Cell 1',
				'### Cell 2',
			]);
			// Kinds survive the round trip: original code cells are still code,
			// original markdown cells are still markup.
			expect(cellsAfter.map(c => c.kind)).toEqual([
				CellKind.Markup,
				CellKind.Markup,
				CellKind.Code,
				CellKind.Code,
				CellKind.Markup,
			]);
		});
	});

	describe('Action wiring (clipboard keybindings)', () => {
		// Test-only subclasses that expose protected `runNotebookAction` so we
		// can invoke action bodies without an active editor pane. Same pattern
		// as selectionKeybindings.vitest.ts and notebookDelete.vitest.ts.
		class TestableCopyCellsAction extends CopyCellsAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}
		class TestableCutCellsAction extends CutCellsAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}
		class TestablePasteCellsAction extends PasteCellsAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}
		class TestablePasteCellsAboveAction extends PasteCellsAboveAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}

		const unusedAccessor: ServicesAccessor = {
			get() { throw new Error('ServicesAccessor must not be used in this action test'); },
		};

		it('CopyCellsAction declares C scoped to command mode and calls copyCells()', () => {
			const action = new CopyCellsAction();
			expect(action.desc.id).toBe('positronNotebook.copyCells');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.KeyC);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

			const notebook = createLabelledTestNotebook(2, ctx);
			notebook.selectionStateMachine.selectCell(notebook.cells.get()[0], CellSelectionType.Normal);
			const spy = vi.spyOn(notebook, 'copyCells');

			new TestableCopyCellsAction().testRun(notebook, unusedAccessor);

			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith();
		});

		it('CutCellsAction declares X scoped to command mode and calls cutCells()', () => {
			const action = new CutCellsAction();
			expect(action.desc.id).toBe('positronNotebook.cutCells');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.KeyX);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

			const notebook = createLabelledTestNotebook(2, ctx);
			notebook.selectionStateMachine.selectCell(notebook.cells.get()[0], CellSelectionType.Normal);
			const spy = vi.spyOn(notebook, 'cutCells');

			new TestableCutCellsAction().testRun(notebook, unusedAccessor);

			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith();
		});

		it('PasteCellsAction declares V scoped to command mode and calls pasteCells()', () => {
			const action = new PasteCellsAction();
			expect(action.desc.id).toBe('positronNotebook.pasteCells');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.KeyV);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

			const notebook = createLabelledTestNotebook(2, ctx);
			const cells = notebook.cells.get();
			notebook.copyCells([cells[0]]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			const spy = vi.spyOn(notebook, 'pasteCells');

			new TestablePasteCellsAction().testRun(notebook, unusedAccessor);

			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith();
		});

		it('PasteCellsAboveAction declares Shift+V scoped to command mode and calls pasteCellsAbove()', () => {
			const action = new PasteCellsAboveAction();
			expect(action.desc.id).toBe('positronNotebook.pasteCellsAbove');
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Shift | KeyCode.KeyV);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

			const notebook = createLabelledTestNotebook(2, ctx);
			const cells = notebook.cells.get();
			notebook.copyCells([cells[0]]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			const spy = vi.spyOn(notebook, 'pasteCellsAbove');

			new TestablePasteCellsAboveAction().testRun(notebook, unusedAccessor);

			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith();
		});
	});
});
