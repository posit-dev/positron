/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockScopableContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellSelectionStatus } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType, getSelectedCells, SelectionState } from '../../browser/selectionMachine.js';

describe('PositronNotebookInstance', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	/** Returns cell content values in current order. */
	function getCellValues(notebook: ReturnType<typeof createTestPositronNotebookInstance>): string[] {
		return notebook.cells.get().map(c => c.model.getValue());
	}

	/** Creates a 5-cell notebook labelled A-E for move tests. */
	function createFiveCellNotebook() {
		return createTestPositronNotebookInstance(
			['A', 'B', 'C', 'D', 'E'].map(v => [v, 'python', CellKind.Code]),
			ctx,
		);
	}

	/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
	describe('Test Harness', () => {
		it('notebook has cells from notebook text model', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['print("hello")', 'python', CellKind.Code],
					['print("world")', 'python', CellKind.Code],
				],
				ctx,
			);

			const cells = notebook.cells.get();
			expect(cells.length, 'Unexpected number of cells in notebook').toBe(2);
			expect(cells[0].model.getValue(), 'Unexpected content for notebook cell 0').toBe('print("hello")');
			expect(cells[1].model.getValue(), 'Unexpected content for notebook cell 1').toBe('print("world")');

			const { textModel } = notebook;
			expect(textModel, 'Notebook should have a text model').toBeDefined();
			expect(textModel!.cells[0].getValue(), 'Unexpected content for text model cell 0').toBe('print("hello")');
			expect(textModel!.cells[1].getValue(), 'Unexpected content for text model cell 1').toBe('print("world")');
		});
	});

	describe('selectionStateMachine', () => {
		it('multi-selection clears editing state from the previously edited cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['print("code")', 'python', CellKind.Code],
					['# markdown', 'markdown', CellKind.Markup],
				],
				ctx,
			);

			const [codeCell, markdownCell] = notebook.cells.get();

			notebook.selectionStateMachine.selectCell(codeCell, CellSelectionType.Edit);
			notebook.selectionStateMachine.selectCell(markdownCell, CellSelectionType.Add);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([codeCell, markdownCell]);
			expect(state.active).toBe(markdownCell);
			expect(codeCell.selectionStatus.get()).not.toBe(CellSelectionStatus.Editing);
			expect(codeCell.selectionStatus.get()).toBe(CellSelectionStatus.Selected);
			expect(markdownCell.selectionStatus.get()).toBe(CellSelectionStatus.Selected);
		});
	});

	describe('moveCells', () => {
		it('contiguous: move single cell down', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (index 1) to after D (target index 4)
			notebook.moveCells([cells[1]], 4);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'D', 'B', 'E']);
		});

		it('contiguous: move single cell up', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move D (index 3) to before B (target index 1)
			notebook.moveCells([cells[3]], 1);
			expect(getCellValues(notebook)).toEqual(['A', 'D', 'B', 'C', 'E']);
		});

		it('contiguous: move block down', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B,C (indices 1,2) to after D (target index 4)
			notebook.moveCells([cells[1], cells[2]], 4);
			expect(getCellValues(notebook)).toEqual(['A', 'D', 'B', 'C', 'E']);
		});

		it('contiguous: no-op when already at target', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (index 1) to target index 1 -- should be a no-op
			notebook.moveCells([cells[1]], 1);
			expect(getCellValues(notebook)).toEqual(['A', 'B', 'C', 'D', 'E']);
		});

		it('non-contiguous: move to end', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (1) and D (3) to after E (target index 5)
			notebook.moveCells([cells[1], cells[3]], 5);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'E', 'B', 'D']);
		});

		it('non-contiguous: move to beginning', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (1) and D (3) to before A (target index 0)
			notebook.moveCells([cells[1], cells[3]], 0);
			expect(getCellValues(notebook)).toEqual(['B', 'D', 'A', 'C', 'E']);
		});

		it('non-contiguous: move to middle', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move A (0) and D (3) to target index 2 (before C)
			notebook.moveCells([cells[0], cells[3]], 2);
			expect(getCellValues(notebook)).toEqual(['B', 'A', 'D', 'C', 'E']);
		});

		it('non-contiguous: does not move unselected cells between selected ones', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move A (0) and C (2) to the end. B (1) should stay in place.
			notebook.moveCells([cells[0], cells[2]], 5);
			expect(getCellValues(notebook)).toEqual(['B', 'D', 'E', 'A', 'C']);
		});

		it('handles unsorted selection (cells passed in reverse order)', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Pass D (3) before B (1) -- moveCells should normalize order
			notebook.moveCells([cells[3], cells[1]], 5);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'E', 'B', 'D']);
		});

		it('handles duplicate cells in selection', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Pass B twice -- should deduplicate and move B once
			notebook.moveCells([cells[1], cells[1]], 4);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'D', 'B', 'E']);
		});
	});

	describe('moveCellsUp', () => {
		it('moves the selected cell up by one position', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);

			notebook.moveCellsUp();

			expect(getCellValues(notebook)).toEqual(['A', 'C', 'B', 'D', 'E']);
		});

		it('is a no-op when the first selected cell is at index 0', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.moveCellsUp();

			expect(getCellValues(notebook)).toEqual(['A', 'B', 'C', 'D', 'E']);
		});

		it('is a no-op when nothing is selected (empty notebook -> NoCells state)', () => {
			// getSelectedCells returns [] only in the NoCells state, which is
			// reached only via an empty notebook (a populated notebook always
			// auto-selects the first cell). This drives the early-return on
			// `cellsToMove.length === 0` in moveCellsUp.
			const notebook = createTestPositronNotebookInstance([], ctx);

			notebook.moveCellsUp();

			expect(notebook.cells.get()).toEqual([]);
		});
	});

	describe('moveCellsDown', () => {
		it('moves the selected cell down by one position', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);

			notebook.moveCellsDown();

			expect(getCellValues(notebook)).toEqual(['A', 'B', 'D', 'C', 'E']);
		});

		it('is a no-op when the last selected cell is at the last index', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[4], CellSelectionType.Normal);

			notebook.moveCellsDown();

			expect(getCellValues(notebook)).toEqual(['A', 'B', 'C', 'D', 'E']);
		});

		it('is a no-op when nothing is selected (empty notebook -> NoCells state)', () => {
			const notebook = createTestPositronNotebookInstance([], ctx);

			notebook.moveCellsDown();

			expect(notebook.cells.get()).toEqual([]);
		});

		it('moves a multi-selection block down as a group', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			notebook.moveCellsDown();

			expect(getCellValues(notebook)).toEqual(['A', 'D', 'B', 'C', 'E']);
		});

		it('sequential calls move the same cell each time (selection follows the move)', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			// First move: A goes from index 0 to index 1.
			notebook.moveCellsDown();
			expect(getCellValues(notebook)).toEqual(['B', 'A', 'C', 'D', 'E']);

			// Second move: A continues to index 2 because selection followed it.
			// Without intermediate-state assertions a broken first move that
			// happened to land at the right final spot would slip through.
			notebook.moveCellsDown();
			expect(getCellValues(notebook)).toEqual(['B', 'C', 'A', 'D', 'E']);

			// Third move: A reaches index 3.
			notebook.moveCellsDown();
			expect(getCellValues(notebook)).toEqual(['B', 'C', 'D', 'A', 'E']);
		});

		it('sequential multi-block moves keep the selection grouped across calls', () => {
			// Multi-cell selection persistence is structurally distinct from
			// single-cell because the state machine has to keep both cells in
			// MultiSelection after the move. A bug that downgraded to
			// SingleSelection mid-sequence would let the second moveCellsDown
			// only move one cell.
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			notebook.moveCellsDown();
			expect(getCellValues(notebook)).toEqual(['A', 'D', 'B', 'C', 'E']);

			notebook.moveCellsDown();
			expect(getCellValues(notebook)).toEqual(['A', 'D', 'E', 'B', 'C']);
		});
	});

	describe('left gutter alignment of code cells (lineNumbersMinChars)', () => {
		function linesOf(n: number): string {
			return Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
		}

		it('initial width is 2 when all cells have fewer than 100 lines', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					[linesOf(5), 'python', CellKind.Code],
					[linesOf(20), 'python', CellKind.Code],
				],
				ctx,
			);
			expect(notebook.getBaseCellEditorOptions('python').value.lineNumbersMinChars).toBe(2);
		});

		it('initial width scales to the widest cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					[linesOf(5), 'python', CellKind.Code],
					[linesOf(20), 'python', CellKind.Code],
					[linesOf(150), 'python', CellKind.Code],
				],
				ctx,
			);
			expect(notebook.getBaseCellEditorOptions('python').value.lineNumbersMinChars).toBe(3);
		});

		it('returns the same options instance for repeated calls with the same language', () => {
			const notebook = createTestPositronNotebookInstance(
				[[linesOf(5), 'python', CellKind.Code]],
				ctx,
			);
			const a = notebook.getBaseCellEditorOptions('python');
			const b = notebook.getBaseCellEditorOptions('python');
			expect(a).toBe(b);
		});

		it('width updates when a cell crosses a digit boundary', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					[linesOf(5), 'python', CellKind.Code],
					[linesOf(9), 'python', CellKind.Code],
				],
				ctx,
			);
			expect(notebook.getBaseCellEditorOptions('python').value.lineNumbersMinChars).toBe(2);
			// Edit in place via applyEdits (as production does) so the cell's
			// shared text buffer reflects the new line count. setValue would
			// replace the model's buffer and leave the cell's buffer stale.
			const textModel = notebook.cells.get()[1].model.textModel!;
			textModel.applyEdits([{ range: textModel.getFullModelRange(), text: linesOf(100) }]);
			expect(notebook.getBaseCellEditorOptions('python').value.lineNumbersMinChars).toBe(3);
		});
	});

	describe('identity', () => {
		// This test was introduced when we added support for split editing.
		// Split editing required the move from having a unique instance per
		// editor input (and therefore URI) to sharing one editor input
		// (and therefore URI) across multiple instances.
		it('two instances for the same URI have distinct IDs', () => {
			const uri = URI.parse('test:///same/notebook.ipynb');
			const viewType = 'jupyter-notebook';

			const a = ctx.disposables.add(ctx.instantiationService.createInstance(
				TestPositronNotebookInstance, uri, viewType, undefined,
			));
			const b = ctx.disposables.add(ctx.instantiationService.createInstance(
				TestPositronNotebookInstance, uri, viewType, undefined,
			));

			expect(a.getId()).not.toBe(b.getId());
		});
	});

	describe('attachView', () => {
		function createInstance(): TestPositronNotebookInstance {
			const notebook = ctx.disposables.add(ctx.instantiationService.createInstance(
				TestPositronNotebookInstance,
				URI.parse(`test:///attach-view.ipynb`),
				'jupyter-notebook',
				undefined,
			));
			notebook.instantiationService = ctx.instantiationService;
			return notebook;
		}

		function makeContainersAndContextKeyService() {
			const editorContainer = document.createElement('div');
			const notebookContainer = document.createElement('div');
			const overlayContainer = document.createElement('div');
			const contextKeyService = ctx.instantiationService
				.invokeFunction(accessor => accessor.get(IContextKeyService))
				.createScoped(editorContainer);
			return { editorContainer, notebookContainer, overlayContainer, contextKeyService };
		}

		it('re-attaching with the same scopedContextKeyService preserves the scoped instantiation service', () => {
			// Each cell's Monaco editor creates a child dependency-injection
			// container under `scopedInstantiationService`. Disposing this
			// container also disposes its children. If attachView rebuilt it
			// on every call, every cached cell's child container would be
			// disposed and the next keystroke would throw
			// "InstantiationService has been disposed". Re-attaching with
			// the same context-key service must reuse the existing container.
			const notebook = createInstance();
			const c = makeContainersAndContextKeyService();
			notebook.attachView(c.editorContainer, c.contextKeyService, c.notebookContainer, c.overlayContainer);
			const isBefore = notebook.scopedInstantiationService;

			notebook.attachView(c.editorContainer, c.contextKeyService, c.notebookContainer, c.overlayContainer);

			expect(notebook.scopedInstantiationService).toBe(isBefore);
		});

		it('re-attaching with a different scopedContextKeyService rebuilds the scoped instantiation service', () => {
			// When a notebook moves to a different editor group, it gets a
			// different context-key service. The scoped container has to be
			// rebuilt so new cells bind their context keys to the new one.
			const notebook = createInstance();
			const editorContainer = document.createElement('div');
			const notebookContainer = document.createElement('div');
			const overlayContainer = document.createElement('div');

			notebook.attachView(editorContainer, new MockScopableContextKeyService(), notebookContainer, overlayContainer);
			const isBefore = notebook.scopedInstantiationService;

			notebook.attachView(editorContainer, new MockScopableContextKeyService(), notebookContainer, overlayContainer);

			expect(notebook.scopedInstantiationService).not.toBe(isBefore);
		});
	});
});
