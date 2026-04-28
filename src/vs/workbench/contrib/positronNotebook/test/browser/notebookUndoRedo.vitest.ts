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
import { POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../browser/ContextKeysManager.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../common/positronNotebookCommon.js';
import { handleNotebookRedo, handleNotebookUndo } from '../../browser/contrib/undoRedo/positronNotebookUndoRedo.js';
import { NotebookOperationType } from '../../browser/IPositronNotebookInstance.js';
import {
	createTestPositronNotebookInstance,
	TestPositronNotebookInstance,
} from './testPositronNotebookInstance.js';

/**
 * Verifies undo/redo behavior on PositronNotebookInstance and the contribution
 * wiring that routes the global Undo/Redo commands to the active notebook.
 *
 * Mirrors the pre-migration e2e (notebook-undo-redo.test.ts) which exercised:
 *  - Add cell + undo + redo (cell array unwind/replay).
 *  - Delete cell + undo + redo + the mixed add/delete history.
 *
 * The model-level describes drive `IUndoRedoService.undo(uri)` directly. The
 * final describe instantiates the contribution to confirm the
 * UndoCommand.addImplementation handler wires through to the model when the
 * notebook editor has focus -- a layer the model-level tests cannot reach.
 *
 * The keyboard-binding registration is upstream VS Code's `'undo'`/`'redo'`
 * command IDs (not a Positron-specific action class), so no test is added at
 * that layer.
 */
describe('PositronNotebookInstance undo/redo', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('addCell undo/redo', () => {
		it('undo after addCell removes the added cell', async () => {
			// Mirrors e2e Test 1, step a: starting from a 1-cell notebook,
			// adding a cell then undoing returns the notebook to 1 cell.
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
			// Mirrors e2e Test 1, step b: redo undoes the undo and the cell
			// returns with identical content.
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
			// Two independent addCell operations should produce two undo
			// stack entries; undoing twice unwinds them last-in-first-out.
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
			// Mirrors e2e Test 2, step b: delete a middle cell, undo, the
			// notebook returns to its prior cell list.
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
			// Mirrors e2e Test 2, step c: redo after undoing the delete
			// performs the delete a second time.
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
			// Three cells deleted by one deleteCells() call should be one undo
			// stack entry: a single undo restores all three at once.
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
	});

	describe('mixed add + delete history (e2e parity)', () => {
		it('add then delete then undo then redo round-trips the notebook', async () => {
			// Mirrors the deleted e2e Test 2 sub-step end-to-end: insert a
			// cell, delete a different cell, undo (restores the deleted cell)
			// then redo (deletes it again). Confirms the undo stack handles
			// multiple cell operations interleaved on a single notebook.
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

			// Undo the delete -- middle cell returns.
			await undoRedo.undo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'# Cell to Delete',
			]);

			// Redo the delete -- middle cell goes again.
			await undoRedo.redo(notebook.uri);
			expect(notebook.cells.get().map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell to Delete',
			]);
		});
	});

	describe('handleNotebookUndo wiring', () => {
		// `handleNotebookUndo` is the body of the UndoCommand handler the
		// contribution registers (`() => handleNotebookUndo(editorService,
		// undoRedoService)`). The model-level describes above cannot reach
		// this layer: they call IUndoRedoService.undo(uri) directly and skip
		// the shouldHandleUndoRedo() focus-key gate plus the
		// setCurrentOperation(NotebookOperationType.Undo) flag the handler
		// sets before dispatching. Driving the free function directly tests
		// the same code path UndoCommand would hit without standing up a
		// global keybinding/dispatcher harness.

		function makeNotebookEditorPane(notebook: TestPositronNotebookInstance): IEditorPane {
			// Minimal IEditorPane shape used by the contribution path:
			// getNotebookInstanceFromEditorPane checks getId() and then casts
			// to PositronNotebookEditor to read `notebookInstance`. We supply
			// only those two fields. stubInterface is not used here because
			// `notebookInstance` is not on IEditorPane -- the production cast
			// adds it -- and stubInterface's Partial<T> type would reject it.
			// We carry `notebookInstance` on the same object via a downcast
			// because PositronNotebookEditor extends IEditorPane with this
			// field; the production cast at notebookUtils.ts:80 reads it via
			// the same widening.
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
			// Focus key is unset by default; bind it to the scoped CK service
			// (mirroring what ContextKeysManager does in production) and leave
			// it false to assert the gate.
			POSITRON_NOTEBOOK_EDITOR_FOCUSED.bindTo(notebook.scopedContextKeyService).set(false);

			const result = handleNotebookUndo(editorService, ctx.get(IUndoRedoService));

			expect(result).toBe(false);
			expect(notebook.cells.get().length).toBe(2);
		});

		it('handleNotebookRedo returns false and leaves the model untouched when the notebook editor is not focused', async () => {
			// Symmetric to the handleNotebookUndo focus-gate test above:
			// without POSITRON_NOTEBOOK_EDITOR_FOCUSED set, the redo handler
			// must yield (return false) so the next priority handler can take
			// the command, and the model must not advance through redo.
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			notebook.addCell(CellKind.Code, 1, false, '# Cell 1');
			// Stage a redo entry: undo the add so the redo stack has work to do.
			await ctx.get(IUndoRedoService).undo(notebook.uri);
			expect(notebook.cells.get().length).toBe(1);

			const editorService = stubInterface<IEditorService>({
				activeEditorPane: makeNotebookEditorPane(notebook),
			});
			POSITRON_NOTEBOOK_EDITOR_FOCUSED.bindTo(notebook.scopedContextKeyService).set(false);

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
			POSITRON_NOTEBOOK_EDITOR_FOCUSED.bindTo(notebook.scopedContextKeyService).set(true);

			const setOpSpy = vi.spyOn(notebook, 'setCurrentOperation');

			const result = await handleNotebookUndo(editorService, ctx.get(IUndoRedoService));

			// Yield not taken: handler claimed the operation.
			expect(result).toBeUndefined();

			// Model unwound through the focus-gated path.
			const cells = notebook.cells.get();
			expect(cells.length).toBe(1);
			expect(cells[0].getContent()).toBe('# Cell 0');

			// Handler flagged the operation as Undo before dispatching, so
			// _syncCells can distinguish undo-restored cells from a fresh add.
			expect(setOpSpy).toHaveBeenCalledWith(NotebookOperationType.Undo);
		});
	});
});
