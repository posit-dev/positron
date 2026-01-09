/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { filterNotebookContext, MAX_NOTEBOOK_CONTEXT_CHARS, MAX_NON_SELECTED_CELL_CONTENT_CHARS } from '../notebookContextFilter';

/**
 * Creates a mock notebook cell for testing
 */
function createMockCell(
	index: number,
	content: string,
	type: positron.notebooks.NotebookCellType = positron.notebooks.NotebookCellType.Code,
	selectionStatus: string = 'unselected'
): positron.notebooks.NotebookCell {
	return {
		id: `cell-${index}`,
		index,
		type,
		content,
		hasOutput: false,
		selectionStatus,
		executionStatus: undefined,
		executionOrder: undefined,
		lastRunSuccess: undefined,
		lastExecutionDuration: undefined
	};
}

/**
 * Creates a mock notebook context for testing
 */
function createMockContext(
	cells: positron.notebooks.NotebookCell[],
	selectedIndices: number[] = []
): positron.notebooks.NotebookContext {
	return {
		uri: 'test://notebook.ipynb',
		cellCount: cells.length,
		kernelId: 'test-kernel',
		kernelLanguage: 'python',
		selectedCells: cells.filter(c => selectedIndices.includes(c.index)),
		allCells: cells
	};
}

suite('notebookContextFilter', () => {
	suite('filterNotebookContext - Content-Aware Filtering', () => {
		test('should preserve small notebooks under budget', () => {
			const cells = [
				createMockCell(0, 'small content'),
				createMockCell(1, 'another small cell')
			];
			const context = createMockContext(cells);

			const result = filterNotebookContext(context);

			assert.strictEqual(result.allCells?.length, 2);
			assert.strictEqual(result.allCells?.[0].content, 'small content');
			assert.strictEqual(result.allCells?.[1].content, 'another small cell');
		});

		test('should truncate non-selected cells when over budget', () => {
			// Create cells with large content that exceeds budget
			const largeContent = 'x'.repeat(30_000); // 30K chars per cell
			const cells = [
				createMockCell(0, largeContent),
				createMockCell(1, largeContent),
				createMockCell(2, largeContent)
			];
			const context = createMockContext(cells, [1]); // Select middle cell

			const result = filterNotebookContext(context);

			assert.ok(result.allCells);
			// Selected cell should be preserved fully
			const selectedCell = result.allCells.find(c => c.index === 1);
			assert.ok(selectedCell);
			assert.strictEqual(selectedCell.content, largeContent);

			// Non-selected cells should be truncated
			const nonSelectedCells = result.allCells.filter(c => c.index !== 1);
			for (const cell of nonSelectedCells) {
				assert.ok(cell.content.length <= MAX_NON_SELECTED_CELL_CONTENT_CHARS);
				assert.ok(cell.content.includes('[truncated]'));
			}
		});

		test('should preserve all selected cells fully', () => {
			const largeContent = 'x'.repeat(20_000);
			const cells = [
				createMockCell(0, largeContent),
				createMockCell(1, largeContent, positron.notebooks.NotebookCellType.Code, 'selected'),
				createMockCell(2, largeContent, positron.notebooks.NotebookCellType.Code, 'selected'),
				createMockCell(3, largeContent)
			];
			const context = createMockContext(cells, [1, 2]); // Select cells 1 and 2

			const result = filterNotebookContext(context);

			assert.ok(result.allCells);
			const selectedCell1 = result.allCells.find(c => c.index === 1);
			const selectedCell2 = result.allCells.find(c => c.index === 2);

			assert.ok(selectedCell1);
			assert.ok(selectedCell2);
			assert.strictEqual(selectedCell1.content, largeContent);
			assert.strictEqual(selectedCell2.content, largeContent);
		});

		test('should reduce cell count if still over budget after truncation', () => {
			// Create many cells with large content
			const largeContent = 'x'.repeat(15_000);
			const cells: positron.notebooks.NotebookCell[] = [];
			for (let i = 0; i < 10; i++) {
				cells.push(createMockCell(i, largeContent));
			}
			const context = createMockContext(cells, [5]); // Select middle cell

			const result = filterNotebookContext(context);

			assert.ok(result.allCells);
			// Selected cell should always be included
			const selectedCell = result.allCells.find(c => c.index === 5);
			assert.ok(selectedCell);
			assert.strictEqual(selectedCell.content, largeContent);

			// Total size should be within budget
			const totalSize = result.allCells.reduce((sum, cell) => sum + cell.content.length, 0);
			// Allow some overhead for XML formatting
			assert.ok(totalSize < MAX_NOTEBOOK_CONTEXT_CHARS * 1.5, `Total size ${totalSize} should be reasonable`);
		});

		test('should handle empty cells', () => {
			const cells = [
				createMockCell(0, ''),
				createMockCell(1, 'content')
			];
			const context = createMockContext(cells);

			const result = filterNotebookContext(context);

			assert.ok(result.allCells);
			assert.strictEqual(result.allCells.length, 2);
		});

		test('should handle context with no allCells', () => {
			const context: positron.notebooks.NotebookContext = {
				uri: 'test://notebook.ipynb',
				cellCount: 5,
				kernelId: 'test-kernel',
				kernelLanguage: 'python',
				selectedCells: [],
				allCells: undefined
			};

			const result = filterNotebookContext(context);

			assert.strictEqual(result.allCells, undefined);
		});

		test('should handle large notebooks without selection', () => {
			const cells: positron.notebooks.NotebookCell[] = [];
			for (let i = 0; i < 30; i++) {
				cells.push(createMockCell(i, `content ${i}`));
			}
			const context = createMockContext(cells, []); // No selection

			const result = filterNotebookContext(context);

			// Large notebooks without selection should have allCells removed
			assert.strictEqual(result.allCells, undefined);
		});

		test('should apply sliding window for large notebooks with selection', () => {
			const cells: positron.notebooks.NotebookCell[] = [];
			for (let i = 0; i < 50; i++) {
				cells.push(createMockCell(i, `content ${i}`));
			}
			const context = createMockContext(cells, [25]); // Select cell 25

			const result = filterNotebookContext(context);

			assert.ok(result.allCells);
			// Should include cells around index 25 (sliding window)
			const indices = result.allCells.map(c => c.index);
			assert.ok(indices.includes(25), 'Should include selected cell');
			// Should be a window around the selected cell
			assert.ok(Math.min(...indices) < 25);
			assert.ok(Math.max(...indices) > 25);
		});

		test('should handle edge case: single very large selected cell', () => {
			const hugeContent = 'x'.repeat(100_000); // 100K chars
			const cells = [
				createMockCell(0, hugeContent, positron.notebooks.NotebookCellType.Code, 'selected')
			];
			const context = createMockContext(cells, [0]);

			const result = filterNotebookContext(context);

			assert.ok(result.allCells);
			// Selected cell should be preserved even if it's huge
			assert.strictEqual(result.allCells[0].content, hugeContent);
		});

		test('should handle mixed cell types', () => {
			const largeContent = 'x'.repeat(20_000);
			const cells = [
				createMockCell(0, largeContent, positron.notebooks.NotebookCellType.Code),
				createMockCell(1, largeContent, positron.notebooks.NotebookCellType.Markdown, 'selected'),
				createMockCell(2, largeContent, positron.notebooks.NotebookCellType.Code)
			];
			const context = createMockContext(cells, [1]);

			const result = filterNotebookContext(context);

			assert.ok(result.allCells);
			const selectedMarkdownCell = result.allCells.find(c => c.index === 1);
			assert.ok(selectedMarkdownCell);
			assert.strictEqual(selectedMarkdownCell.type, positron.notebooks.NotebookCellType.Markdown);
			assert.strictEqual(selectedMarkdownCell.content, largeContent);
		});
	});
});

