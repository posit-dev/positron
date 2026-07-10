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
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
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
import { singleKeybinding } from './keybindingTestUtils.js';
import {
	CellSelectionType,
	getActiveCell,
} from '../../browser/selectionMachine.js';
import {
	createLabelledTestNotebook,
	createTestPositronNotebookInstance,
} from './testPositronNotebookInstance.js';

describe('PositronNotebookInstance.copy/cut/paste*', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		.stub(IClipboardService, new TestClipboardService())
		.build();

	describe('copyCells', () => {
		it('copies the given cell into the notebook-service clipboard and writes its content to the system clipboard', () => {
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
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);

			notebook.copyCells();

			const clipboardCells = ctx.get(IPositronNotebookService).getClipboardCells();
			expect(clipboardCells.length).toBe(1);
			expect(clipboardCells[0].source).toBe(cells[1].getContent());
		});

		it('copyCells() is a no-op with empty selection', () => {
			// An empty notebook is the only way into the NoCells selection
			// state -- populated notebooks auto-select cell 0.
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
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			], ctx);
			const cellsBefore = notebook.cells.get();
			notebook.copyCells([cellsBefore[0]]);

			notebook.pasteCells(2);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell 0',
				'# Cell 2',
			]);

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
			const notebook = createLabelledTestNotebook(3, ctx);
			const cellsBefore = notebook.cells.get();
			notebook.copyCells([cellsBefore[2]]);
			// With cell 0 active, getInsertionIndex() would default to 1 (after
			// the active cell). Passing 0 must override that.
			notebook.selectionStateMachine.selectCell(cellsBefore[0], CellSelectionType.Normal);

			notebook.pasteCells(0);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(4);
			expect(cellsAfter[0].getContent()).toBe(cellsBefore[2].getContent());
		});

		it('pasteCells() is a no-op when the clipboard is empty', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			ctx.get(IPositronNotebookService).clearClipboard();
			const before = notebook.cells.get().map(c => c.getContent());

			expect(() => notebook.pasteCells()).not.toThrow();

			expect(notebook.cells.get().map(c => c.getContent())).toEqual(before);
		});

		it('copy + paste round-trip restores outputs on the underlying text model', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code, [{
					outputId: 'test-output',
					outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('hello') }],
				}]]],
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			notebook.copyCells([cellsBefore[0]]);

			notebook.pasteCells(1);

			const { textModel } = notebook;
			expect(textModel).toBeDefined();
			expect(textModel!.cells.length).toBe(2);
			expect(textModel!.cells[1].outputs.length).toBe(1);
			expect(textModel!.cells[1].outputs[0].outputId).toBe('test-output');
		});
	});

	describe('cutCells', () => {
		it('cut + paste-elsewhere moves the cell to the new position', () => {
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
			const notebook = createLabelledTestNotebook(3, ctx);
			const cellsBefore = notebook.cells.get();
			const targetContent = cellsBefore[1].getContent();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);

			notebook.cutCells();

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(2);
			expect(cellsAfter.map(c => c.getContent())).not.toContain(targetContent);
			const clipboardCells = ctx.get(IPositronNotebookService).getClipboardCells();
			expect(clipboardCells.length).toBe(1);
			expect(clipboardCells[0].source).toBe(targetContent);
		});

		it('cutCells() is a no-op with empty selection', () => {
			const notebook = createTestPositronNotebookInstance([], ctx);
			ctx.get(IPositronNotebookService).clearClipboard();

			expect(() => notebook.cutCells()).not.toThrow();

			expect(notebook.cells.get().length).toBe(0);
			expect(ctx.get(IPositronNotebookService).hasClipboardCells()).toBe(false);
		});
	});

	describe('pasteCellsAbove', () => {
		it('inserts at the active cell index (above, not below)', () => {
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
			// Reaching the null-active-cell branch requires an empty notebook,
			// so copy from a populated source and paste into an empty target;
			// the notebook-service clipboard is process-wide.
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
			expect(cellsAfter.map(c => c.kind)).toEqual([
				CellKind.Markup,
				CellKind.Markup,
				CellKind.Code,
				CellKind.Code,
				CellKind.Markup,
			]);
		});

		it('cut from middle leaves leading and trailing cells intact and preserves cell kinds', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['### Cell 2', 'markdown', CellKind.Markup],
				['### Cell 3', 'markdown', CellKind.Markup],
				['# Cell 4', 'python', CellKind.Code],
			], ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cellsBefore[3], CellSelectionType.Add);

			notebook.cutCells();
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 4',
			]);

			const cellsAfterCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterCut[1], CellSelectionType.Normal);
			notebook.pasteCells();

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 4',
				'# Cell 1',
				'### Cell 2',
				'### Cell 3',
			]);
			expect(cellsAfter.map(c => c.kind)).toEqual([
				CellKind.Code,
				CellKind.Code,
				CellKind.Code,
				CellKind.Markup,
				CellKind.Markup,
			]);
		});

		it('cut from end leaves leading cells intact and pastes after the first remaining cell', () => {
			const notebook = createLabelledTestNotebook(5, ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsBefore[3], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cellsBefore[4], CellSelectionType.Add);

			notebook.cutCells();
			expect(notebook.cells.get().map(c => c.getContent())).toEqual(['A', 'B']);

			const cellsAfterCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterCut[0], CellSelectionType.Normal);
			notebook.pasteCells();

			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'A',
				'C',
				'D',
				'E',
				'B',
			]);
		});

		it('second multi-cell cut/paste operates on state from first', () => {
			const notebook = createLabelledTestNotebook(6, ctx);

			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Add);
			notebook.cutCells();

			const cellsAfterFirstCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterFirstCut[3], CellSelectionType.Normal);
			notebook.pasteCells();
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'A', 'D', 'E', 'F', 'B', 'C',
			]);

			const cellsAfterFirstPaste = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterFirstPaste[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsAfterFirstPaste[1], CellSelectionType.Add);
			notebook.cutCells();

			const cellsAfterSecondCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterSecondCut[1], CellSelectionType.Normal);
			notebook.pasteCells();
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'E', 'F', 'A', 'D', 'B', 'C',
			]);
		});
	});

	describe('Multi-cell cut/paste undo/redo', () => {
		it('undo restores cells removed by multi-select cut', async () => {
			const notebook = createLabelledTestNotebook(5, ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cellsBefore[3], CellSelectionType.Add);
			notebook.cutCells();
			expect(notebook.cells.get().length).toBe(2);

			await ctx.get(IUndoRedoService).undo(notebook.uri);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'A', 'B', 'C', 'D', 'E',
			]);
		});

		it('redo re-applies multi-select cut after undo', async () => {
			const notebook = createLabelledTestNotebook(5, ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cellsBefore[3], CellSelectionType.Add);
			notebook.cutCells();
			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'A', 'B', 'C', 'D', 'E',
			]);

			await undoRedo.redo(notebook.uri);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual(['A', 'E']);
		});

		it('undo of paste after multi-select cut leaves notebook in cut state', async () => {
			const notebook = createLabelledTestNotebook(5, ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cellsBefore[3], CellSelectionType.Add);
			notebook.cutCells();
			const cellsAfterCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterCut[0], CellSelectionType.Normal);
			notebook.pasteCells();
			expect(notebook.cells.get().length).toBe(5);

			await ctx.get(IUndoRedoService).undo(notebook.uri);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual(['A', 'E']);
		});

		it('redo re-applies multi-select paste after undo', async () => {
			const notebook = createLabelledTestNotebook(5, ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cellsBefore[3], CellSelectionType.Add);
			notebook.cutCells();
			const cellsAfterCut = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsAfterCut[0], CellSelectionType.Normal);
			notebook.pasteCells();
			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual(['A', 'E']);

			await undoRedo.redo(notebook.uri);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'A', 'B', 'C', 'D', 'E',
			]);
		});

		it('cut-all then paste-into-empty then undo then redo preserves cell kinds and content', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['### Cell 2', 'markdown', CellKind.Markup],
				['### Cell 3', 'markdown', CellKind.Markup],
			], ctx);
			const cellsBefore = notebook.cells.get();
			const originalContents = ['# Cell 0', '# Cell 1', '### Cell 2', '### Cell 3'];
			const originalKinds = [CellKind.Code, CellKind.Code, CellKind.Markup, CellKind.Markup];

			notebook.cutCells(cellsBefore);
			expect(notebook.cells.get().length).toBe(0);
			expect(ctx.get(IPositronNotebookService).getClipboardCells().length).toBe(4);

			notebook.pasteCells();
			const afterPaste = notebook.cells.get();
			expect(afterPaste.map(c => c.getContent())).toEqual(originalContents);
			expect(afterPaste.map(c => c.kind)).toEqual(originalKinds);

			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);
			expect(notebook.cells.get().length).toBe(0);

			await undoRedo.redo(notebook.uri);
			const afterRedo = notebook.cells.get();
			expect(afterRedo.map(c => c.getContent())).toEqual(originalContents);
			expect(afterRedo.map(c => c.kind)).toEqual(originalKinds);
		});
	});

	describe('Action wiring (clipboard keybindings)', () => {
		// Test-only subclasses expose protected `runNotebookAction` so we can
		// invoke action bodies without an active editor pane.
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
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.KeyC);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

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
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.KeyX);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

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
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.KeyV);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

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
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyMod.Shift | KeyCode.KeyV);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);

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
