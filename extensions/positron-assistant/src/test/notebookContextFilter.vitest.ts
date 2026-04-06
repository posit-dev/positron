/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import * as positron from 'positron';
import { filterNotebookContext, MAX_NOTEBOOK_CONTEXT_CHARS, MAX_NON_SELECTED_CELL_CONTENT_CHARS } from '../notebookContextFilter';

/**
 * Creates a mock notebook cell for testing
 */
/// <reference types="vitest/globals" />
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
/// <reference types="vitest/globals" />
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

describe('notebookContextFilter', () => {
	describe('filterNotebookContext - Content-Aware Filtering', () => {
		it('should preserve small notebooks under budget', () => {
			const cells = [
				createMockCell(0, 'small content'),
				createMockCell(1, 'another small cell')
			];
			const context = createMockContext(cells);

			const result = filterNotebookContext(context);

			expect(result.allCells?.length).toBe(2);
			expect(result.allCells?.[0].content).toBe('small content');
			expect(result.allCells?.[1].content).toBe('another small cell');
		});

		it('should truncate non-selected cells when over budget', () => {
			// Create cells with large content that exceeds budget
			const largeContent = 'x'.repeat(30_000); // 30K chars per cell
			const cells = [
				createMockCell(0, largeContent),
				createMockCell(1, largeContent),
				createMockCell(2, largeContent)
			];
			const context = createMockContext(cells, [1]); // Select middle cell

			const result = filterNotebookContext(context);

			expect(result.allCells).toBeTruthy();
			// Selected cell should be preserved fully
			const selectedCell = result.allCells!.find(c => c.index === 1);
			expect(selectedCell).toBeTruthy();
			expect(selectedCell!.content).toBe(largeContent);

			// Non-selected cells should be truncated
			const nonSelectedCells = result.allCells!.filter(c => c.index !== 1);
			for (const cell of nonSelectedCells) {
				expect(cell.content.length <= MAX_NON_SELECTED_CELL_CONTENT_CHARS).toBeTruthy();
				expect(cell.content.includes('[truncated]')).toBeTruthy();
			}
		});

		it('should preserve all selected cells fully', () => {
			const largeContent = 'x'.repeat(20_000);
			const cells = [
				createMockCell(0, largeContent),
				createMockCell(1, largeContent, positron.notebooks.NotebookCellType.Code, 'selected'),
				createMockCell(2, largeContent, positron.notebooks.NotebookCellType.Code, 'selected'),
				createMockCell(3, largeContent)
			];
			const context = createMockContext(cells, [1, 2]); // Select cells 1 and 2

			const result = filterNotebookContext(context);

			expect(result.allCells).toBeTruthy();
			const selectedCell1 = result.allCells!.find(c => c.index === 1);
			const selectedCell2 = result.allCells!.find(c => c.index === 2);

			expect(selectedCell1).toBeTruthy();
			expect(selectedCell2).toBeTruthy();
			expect(selectedCell1!.content).toBe(largeContent);
			expect(selectedCell2!.content).toBe(largeContent);
		});

		it('should reduce cell count if still over budget after truncation', () => {
			// Create many cells with large content
			const largeContent = 'x'.repeat(15_000);
			const cells: positron.notebooks.NotebookCell[] = [];
			for (let i = 0; i < 10; i++) {
				cells.push(createMockCell(i, largeContent));
			}
			const context = createMockContext(cells, [5]); // Select middle cell

			const result = filterNotebookContext(context);

			expect(result.allCells).toBeTruthy();
			// Selected cell should always be included
			const selectedCell = result.allCells!.find(c => c.index === 5);
			expect(selectedCell).toBeTruthy();
			expect(selectedCell!.content).toBe(largeContent);

			// Total size should be within budget
			const totalSize = result.allCells!.reduce((sum, cell) => sum + cell.content.length, 0);
			// Allow some overhead for XML formatting
			expect(totalSize < MAX_NOTEBOOK_CONTEXT_CHARS * 1.5).toBeTruthy();
		});

		it('should handle empty cells', () => {
			const cells = [
				createMockCell(0, ''),
				createMockCell(1, 'content')
			];
			const context = createMockContext(cells);

			const result = filterNotebookContext(context);

			expect(result.allCells).toBeTruthy();
			expect(result.allCells!.length).toBe(2);
		});

		it('should handle context with no allCells', () => {
			const context: positron.notebooks.NotebookContext = {
				uri: 'test://notebook.ipynb',
				cellCount: 5,
				kernelId: 'test-kernel',
				kernelLanguage: 'python',
				selectedCells: [],
				allCells: undefined
			};

			const result = filterNotebookContext(context);

			expect(result.allCells).toBe(undefined);
		});

		it('should handle large notebooks without selection', () => {
			const cells: positron.notebooks.NotebookCell[] = [];
			for (let i = 0; i < 30; i++) {
				cells.push(createMockCell(i, `content ${i}`));
			}
			const context = createMockContext(cells, []); // No selection

			const result = filterNotebookContext(context);

			// Large notebooks without selection should have allCells removed
			expect(result.allCells).toBe(undefined);
		});

		it('should apply sliding window for large notebooks with selection', () => {
			const cells: positron.notebooks.NotebookCell[] = [];
			for (let i = 0; i < 50; i++) {
				cells.push(createMockCell(i, `content ${i}`));
			}
			const context = createMockContext(cells, [25]); // Select cell 25

			const result = filterNotebookContext(context);

			expect(result.allCells).toBeTruthy();
			// Should include cells around index 25 (sliding window)
			const indices = result.allCells!.map(c => c.index);
			expect(indices.includes(25)).toBeTruthy();
			// Should be a window around the selected cell
			expect(Math.min(...indices) < 25).toBeTruthy();
			expect(Math.max(...indices) > 25).toBeTruthy();
		});

		it('should handle edge case: single very large selected cell', () => {
			const hugeContent = 'x'.repeat(100_000); // 100K chars
			const cells = [
				createMockCell(0, hugeContent, positron.notebooks.NotebookCellType.Code, 'selected')
			];
			const context = createMockContext(cells, [0]);

			const result = filterNotebookContext(context);

			expect(result.allCells).toBeTruthy();
			// Selected cell should be preserved even if it's huge
			expect(result.allCells![0].content).toBe(hugeContent);
		});

		it('should handle mixed cell types', () => {
			const largeContent = 'x'.repeat(20_000);
			const cells = [
				createMockCell(0, largeContent, positron.notebooks.NotebookCellType.Code),
				createMockCell(1, largeContent, positron.notebooks.NotebookCellType.Markdown, 'selected'),
				createMockCell(2, largeContent, positron.notebooks.NotebookCellType.Code)
			];
			const context = createMockContext(cells, [1]);

			const result = filterNotebookContext(context);

			expect(result.allCells).toBeTruthy();
			const selectedMarkdownCell = result.allCells!.find(c => c.index === 1);
			expect(selectedMarkdownCell).toBeTruthy();
			expect(selectedMarkdownCell!.type).toBe(positron.notebooks.NotebookCellType.Markdown);
			expect(selectedMarkdownCell!.content).toBe(largeContent);
		});
	});
});
