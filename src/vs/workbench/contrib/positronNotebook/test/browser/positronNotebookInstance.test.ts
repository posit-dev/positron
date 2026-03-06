/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';

suite('PositronNotebookInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
	suite('Test Harness', () => {
		test('notebook has cells from notebook text model', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['print("hello")', 'python', CellKind.Code],
					['print("world")', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 2, 'Unexpected number of cells in notebook');
			assert.strictEqual(cells[0].model.getValue(), 'print("hello")', 'Unexpected content for notebook cell 0');
			assert.strictEqual(cells[1].model.getValue(), 'print("world")', 'Unexpected content for notebook cell 1');

			const { textModel } = notebook;
			assert.ok(textModel, 'Notebook should have a text model');
			assert.strictEqual(textModel.cells[0].getValue(), 'print("hello")', 'Unexpected content for text model cell 0');
			assert.strictEqual(textModel.cells[1].getValue(), 'print("world")', 'Unexpected content for text model cell 1');
		});
	});

	suite('moveCells', () => {

		/** Helper: returns cell content values in current order. */
		function getCellValues(notebook: ReturnType<typeof createTestPositronNotebookInstance>): string[] {
			return notebook.cells.get().map(c => c.model.getValue());
		}

		/** Creates a 5-cell notebook labelled A-E for move tests. */
		function createFiveCellNotebook() {
			return createTestPositronNotebookInstance(
				['A', 'B', 'C', 'D', 'E'].map(v => [v, 'python', CellKind.Code]),
				disposables,
			);
		}

		test('contiguous: move single cell down', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (index 1) to after D (target index 4)
			notebook.moveCells([cells[1]], 4);
			assert.deepStrictEqual(getCellValues(notebook), ['A', 'C', 'D', 'B', 'E']);
		});

		test('contiguous: move single cell up', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move D (index 3) to before B (target index 1)
			notebook.moveCells([cells[3]], 1);
			assert.deepStrictEqual(getCellValues(notebook), ['A', 'D', 'B', 'C', 'E']);
		});

		test('contiguous: move block down', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B,C (indices 1,2) to after D (target index 4)
			notebook.moveCells([cells[1], cells[2]], 4);
			assert.deepStrictEqual(getCellValues(notebook), ['A', 'D', 'B', 'C', 'E']);
		});

		test('contiguous: no-op when already at target', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (index 1) to target index 1 -- should be a no-op
			notebook.moveCells([cells[1]], 1);
			assert.deepStrictEqual(getCellValues(notebook), ['A', 'B', 'C', 'D', 'E']);
		});

		test('non-contiguous: move to end', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (1) and D (3) to after E (target index 5)
			notebook.moveCells([cells[1], cells[3]], 5);
			assert.deepStrictEqual(getCellValues(notebook), ['A', 'C', 'E', 'B', 'D']);
		});

		test('non-contiguous: move to beginning', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (1) and D (3) to before A (target index 0)
			notebook.moveCells([cells[1], cells[3]], 0);
			assert.deepStrictEqual(getCellValues(notebook), ['B', 'D', 'A', 'C', 'E']);
		});

		test('non-contiguous: move to middle', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move A (0) and D (3) to target index 2 (before C)
			notebook.moveCells([cells[0], cells[3]], 2);
			assert.deepStrictEqual(getCellValues(notebook), ['B', 'A', 'D', 'C', 'E']);
		});

		test('non-contiguous: does not move unselected cells between selected ones', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move A (0) and C (2) to the end. B (1) should stay in place.
			notebook.moveCells([cells[0], cells[2]], 5);
			assert.deepStrictEqual(getCellValues(notebook), ['B', 'D', 'E', 'A', 'C']);
		});
	});
});
