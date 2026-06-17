/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IEditorPane } from '../../../../common/editor.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../common/positronNotebookCommon.js';
import { handleNotebookRedo, handleNotebookUndo } from '../../browser/contrib/undoRedo/positronNotebookUndoRedo.js';
import { NotebookOperationType } from '../../browser/IPositronNotebookInstance.js';
import {
	createTestPositronNotebookInstance,
	TestPositronNotebookInstance,
} from './testPositronNotebookInstance.js';

describe('PositronNotebookInstance undo/redo', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('addCell undo/redo', () => {
		it('undo after addCell removes the added cell', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			expect(notebook.cells.get().length).toBe(2);

			await ctx.get(IUndoRedoService).undo(notebook.uri);

			const cells = notebook.cells.get();
			expect(cells.length).toBe(1);
			expect(cells[0].getContent()).toBe('# Cell 0');
		});

		it('redo after undo re-inserts the cell with the same content', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);

			await undoRedo.redo(notebook.uri);

			const cells = notebook.cells.get();
			expect(cells.length).toBe(2);
			expect(cells.map(c => c.getContent())).toEqual(['# Cell 0', '# Cell 1']);
		});

		it('multi-undo unwinds inserts in LIFO order', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			notebook.addCell(CellKind.Code, 2, false, '# Cell 2');
			expect(notebook.cells.get().length).toBe(3);

			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
			]);

			await undoRedo.undo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual(['# Cell 0']);
		});
	});

	describe('deleteCells undo/redo', () => {
		it('undo restores a deleted cell at its original index with content', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell to Delete', 'python', CellKind.Code],
			], ctx);
			const cells = notebook.cells.get();
			notebook.deleteCells([cells[1]]);
			expect(notebook.cells.get().length).toBe(2);

			await ctx.get(IUndoRedoService).undo(notebook.uri);

			const restored = notebook.cells.get();
			expect(restored.length).toBe(3);
			expect(restored.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell to Delete',
			]);
		});

		it('redo deletes the cell again', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell to Delete', 'python', CellKind.Code],
			], ctx);
			const cells = notebook.cells.get();
			notebook.deleteCells([cells[1]]);
			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);

			await undoRedo.redo(notebook.uri);

			const after = notebook.cells.get();
			expect(after.length).toBe(2);
			expect(after.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell to Delete',
			]);
		});

		it('multi-cell deleteCells undo restores all cells in one step', async () => {
			// One deleteCells() call must produce one undo stack entry, not three.
			const notebook = createTestPositronNotebookInstance(
				Array.from({ length: 5 }, (_, i): [string, string, CellKind] => [
					`# Cell ${i}`,
					'python',
					CellKind.Code,
				]),
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.deleteCells([cells[1], cells[2], cells[3]]);
			expect(notebook.cells.get().length).toBe(2);

			await ctx.get(IUndoRedoService).undo(notebook.uri);

			const restored = notebook.cells.get();
			expect(restored.length).toBe(5);
			expect(restored.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell 2',
				'# Cell 3',
				'# Cell 4',
			]);
		});

		it('delete-all then undo then redo round-trips a mixed code+markdown notebook', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['### Cell 2', 'markdown', CellKind.Markup],
				['### Cell 3', 'markdown', CellKind.Markup],
			], ctx);
			const cellsBefore = notebook.cells.get();

			notebook.deleteCells(cellsBefore);
			expect(notebook.cells.get().length).toBe(0);

			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);

			const restored = notebook.cells.get();
			expect(restored.length).toBe(4);
			expect(restored.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'### Cell 2',
				'### Cell 3',
			]);
			expect(restored.map(c => c.kind)).toEqual([
				CellKind.Code,
				CellKind.Code,
				CellKind.Markup,
				CellKind.Markup,
			]);

			await undoRedo.redo(notebook.uri);
			expect(notebook.cells.get().length).toBe(0);
		});
	});

	describe('moveCells undo/redo', () => {
		it('undo after moveCells restores cells to their original positions', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			], ctx);
			const cells = notebook.cells.get();
			notebook.moveCells([cells[0]], 2);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 1',
				'# Cell 0',
				'# Cell 2',
			]);

			await ctx.get(IUndoRedoService).undo(notebook.uri);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell 2',
			]);
		});

		it('redo after undo re-applies the move', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			], ctx);
			const cells = notebook.cells.get();
			notebook.moveCells([cells[0]], 2);
			const undoRedo = ctx.get(IUndoRedoService);
			await undoRedo.undo(notebook.uri);

			await undoRedo.redo(notebook.uri);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 1',
				'# Cell 0',
				'# Cell 2',
			]);
		});

		it('multi-cell moveCells undo restores all moved cells in one step', async () => {
			// One moveCells() call must produce one undo stack entry, regardless
			// of how many cells moved -- otherwise multi-cell moves would need
			// repeated undos to fully reverse.
			const notebook = createTestPositronNotebookInstance(
				Array.from({ length: 5 }, (_, i): [string, string, CellKind] => [
					`# Cell ${i}`,
					'python',
					CellKind.Code,
				]),
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.moveCells([cells[0], cells[1]], 5);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 2',
				'# Cell 3',
				'# Cell 4',
				'# Cell 0',
				'# Cell 1',
			]);

			await ctx.get(IUndoRedoService).undo(notebook.uri);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell 2',
				'# Cell 3',
				'# Cell 4',
			]);
		});
	});

	describe('mixed add + delete history', () => {
		it('add then delete then undo then redo round-trips the notebook', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
			], ctx);

			notebook.addCell(CellKind.Code, 2, false, '# Cell to Delete');
			expect(notebook.cells.get().length).toBe(3);

			notebook.deleteCells([notebook.cells.get()[1]]);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell to Delete',
			]);

			const undoRedo = ctx.get(IUndoRedoService);

			await undoRedo.undo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell to Delete',
			]);

			await undoRedo.redo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell to Delete',
			]);
		});
	});

	describe('handleNotebookUndo wiring', () => {
		// Drives the UndoCommand handler body directly so the focus-key gate
		// (shouldHandleUndoRedo) and the setCurrentOperation(Undo) flag get
		// exercised -- the model-level describes call IUndoRedoService.undo(uri)
		// and skip both.

		function makeNotebookEditorPane(notebook: TestPositronNotebookInstance): IEditorPane {
			// `notebookInstance` is not on IEditorPane; production code at
			// notebookUtils.ts:80 widens via the same cast to read it off
			// PositronNotebookEditor.
			// eslint-disable-next-line local/code-no-dangerous-type-assertions -- modeling PositronNotebookEditor's `notebookInstance` field on a structurally-stubbed IEditorPane (production code casts the same way)
			const overrides = { getId: () => POSITRON_NOTEBOOK_EDITOR_ID, notebookInstance: notebook } as unknown as Partial<IEditorPane>;
			return stubInterface<IEditorPane>(overrides);
		}

		it('handleNotebookUndo returns false and leaves the model untouched when the notebook editor is not focused', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			const editorService = stubInterface<IEditorService>({
				activeEditorPane: makeNotebookEditorPane(notebook),
			});
			NotebookContextKeys.editorFocused.bindTo(notebook.scopedContextKeyService).set(false);

			const result = handleNotebookUndo(editorService, ctx.get(IUndoRedoService));

			expect(result).toBe(false);
			expect(notebook.cells.get().length).toBe(2);
		});

		it('handleNotebookRedo returns false and leaves the model untouched when the notebook editor is not focused', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			// Stage a redo entry by undoing the add.
			await ctx.get(IUndoRedoService).undo(notebook.uri);
			expect(notebook.cells.get().length).toBe(1);

			const editorService = stubInterface<IEditorService>({
				activeEditorPane: makeNotebookEditorPane(notebook),
			});
			NotebookContextKeys.editorFocused.bindTo(notebook.scopedContextKeyService).set(false);

			const result = handleNotebookRedo(editorService, ctx.get(IUndoRedoService));

			expect(result).toBe(false);
			expect(notebook.cells.get().length).toBe(1);
		});

		it('handleNotebookUndo routes through to the model and sets the Undo operation flag when focus is set', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			expect(notebook.cells.get().length).toBe(2);

			const editorService = stubInterface<IEditorService>({
				activeEditorPane: makeNotebookEditorPane(notebook),
			});
			NotebookContextKeys.editorFocused.bindTo(notebook.scopedContextKeyService).set(true);

			const setOpSpy = vi.spyOn(notebook, 'setCurrentOperation');

			const result = await handleNotebookUndo(editorService, ctx.get(IUndoRedoService));

			expect(result).toBeUndefined();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(1);
			expect(cells[0].getContent()).toBe('# Cell 0');

			// Operation flag must be set before dispatch so _syncCells can
			// distinguish undo-restored cells from a fresh add.
			expect(setOpSpy).toHaveBeenCalledWith(NotebookOperationType.Undo);
		});

		it('handleNotebookRedo routes through to the model and sets the Redo operation flag when focus is set', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			// Stage a redo entry by undoing first.
			await ctx.get(IUndoRedoService).undo(notebook.uri);
			expect(notebook.cells.get().length).toBe(1);

			const editorService = stubInterface<IEditorService>({
				activeEditorPane: makeNotebookEditorPane(notebook),
			});
			NotebookContextKeys.editorFocused.bindTo(notebook.scopedContextKeyService).set(true);

			const setOpSpy = vi.spyOn(notebook, 'setCurrentOperation');

			const result = await handleNotebookRedo(editorService, ctx.get(IUndoRedoService));

			expect(result).toBeUndefined();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(2);
			expect(cells[1].getContent()).toBe('# Cell 1');

			expect(setOpSpy).toHaveBeenCalledWith(NotebookOperationType.Redo);
		});

		it('handleNotebookUndo restores previously deleted cells when the notebook is empty and no focus key is set (#10397)', async () => {
			// Regression for #10397: after deleting the last cell the notebook is
			// empty, so neither editorFocused nor cellEditorFocused can be set --
			// yet Cmd+Z must still unwind the delete. shouldHandleUndoRedo's
			// emptyNotebook branch is the only thing that lets the handler claim
			// the command here; without it undo silently does nothing.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.deleteCells(notebook.cells.get());
			expect(notebook.cells.get().length).toBe(0);

			const editorService = stubInterface<IEditorService>({
				activeEditorPane: makeNotebookEditorPane(notebook),
			});
			// Both focus keys explicitly false: an empty notebook holds no focus,
			// so only the emptyNotebook branch can carry this.
			NotebookContextKeys.editorFocused.bindTo(notebook.scopedContextKeyService).set(false);
			NotebookContextKeys.cellEditorFocused.bindTo(notebook.scopedContextKeyService).set(false);

			const setOpSpy = vi.spyOn(notebook, 'setCurrentOperation');

			const result = await handleNotebookUndo(editorService, ctx.get(IUndoRedoService));

			expect(result).toBeUndefined();

			const restored = notebook.cells.get();
			expect(restored.length).toBe(1);
			expect(restored[0].getContent()).toBe('# Cell 0');
			expect(setOpSpy).toHaveBeenCalledWith(NotebookOperationType.Undo);
		});

		it('handleNotebookRedo re-adds the cells when the notebook is empty and no focus key is set', async () => {
			// Symmetric to the undo case: add a cell into an empty notebook, undo
			// to return to empty (staging a redo entry), then redo while still
			// empty and unfocused. Exercises the emptyNotebook branch for redo.
			const notebook = createTestPositronNotebookInstance([], ctx);
			notebook.addCell(CellKind.Code, 0, false, '# Cell 0');
			expect(notebook.cells.get().length).toBe(1);
			await ctx.get(IUndoRedoService).undo(notebook.uri);
			expect(notebook.cells.get().length).toBe(0);

			const editorService = stubInterface<IEditorService>({
				activeEditorPane: makeNotebookEditorPane(notebook),
			});
			NotebookContextKeys.editorFocused.bindTo(notebook.scopedContextKeyService).set(false);
			NotebookContextKeys.cellEditorFocused.bindTo(notebook.scopedContextKeyService).set(false);

			const setOpSpy = vi.spyOn(notebook, 'setCurrentOperation');

			const result = await handleNotebookRedo(editorService, ctx.get(IUndoRedoService));

			expect(result).toBeUndefined();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(1);
			expect(cells[0].getContent()).toBe('# Cell 0');
			expect(setOpSpy).toHaveBeenCalledWith(NotebookOperationType.Redo);
		});
	});
});
