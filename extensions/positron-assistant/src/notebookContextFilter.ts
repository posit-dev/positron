/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

/**
 * Maximum number of cells in a notebook to include all cells in the context.
 * Notebooks with more cells will have filtering applied to avoid consuming
 * too much context space.
 */
const MAX_CELLS_FOR_ALL_CELLS_CONTEXT = 20;

/**
 * Default window size for sliding window filtering.
 * Number of cells to include before and after an anchor cell.
 */
const SLIDING_WINDOW_SIZE = 10;

/**
 * Calculates a sliding window of cells around an anchor cell index.
 * @param totalCells Total number of cells in the notebook
 * @param anchorIndex Index of the cell to center the window around
 * @param windowSize Number of cells to include before and after the anchor (default 10)
 * @returns Object with startIndex and endIndex for slicing the cells array
 */
export function calculateSlidingWindow(
	totalCells: number,
	anchorIndex: number,
	windowSize: number = SLIDING_WINDOW_SIZE
): { startIndex: number; endIndex: number } {
	const startIndex = Math.max(0, anchorIndex - windowSize);
	const endIndex = Math.min(totalCells, anchorIndex + windowSize + 1);
	return { startIndex, endIndex };
}

/**
 * Filters notebook context based on notebook size and selection state.
 *
 * Filtering rules:
 * - Small notebooks (<20 cells): Keep all cells
 * - Large notebooks (>=20 cells) with selection: Apply sliding window around last selected cell
 * - Large notebooks (>=20 cells) without selection: Remove allCells field
 *
 * @param context The notebook context to filter
 * @returns Filtered notebook context
 */
export function filterNotebookContext(
	context: positron.notebooks.NotebookContext
): positron.notebooks.NotebookContext {
	// If no allCells or empty, return as-is
	if (!context.allCells || context.allCells.length === 0) {
		return context;
	}

	const totalCells = context.cellCount;

	// Small notebooks: keep all cells
	if (totalCells < MAX_CELLS_FOR_ALL_CELLS_CONTEXT) {
		return context;
	}

	// Large notebooks without selection: remove allCells to save context space
	if (context.selectedCells.length === 0) {
		return {
			...context,
			allCells: undefined
		};
	}

	// Large notebooks with selection: apply sliding window around last selected cell
	const lastSelectedIndex = Math.max(...context.selectedCells.map(cell => cell.index));
	const { startIndex, endIndex } = calculateSlidingWindow(totalCells, lastSelectedIndex);

	const filteredCells = context.allCells.slice(startIndex, endIndex);

	return {
		...context,
		allCells: filteredCells
	};
}

/**
 * Determines which cells to include in context, handling fallback cases.
 *
 * This function extends `filterNotebookContext` by providing a fallback strategy
 * for cases where `allCells` is undefined (large notebooks without selection).
 * In such cases, it uses a sliding window around recent executed cells.
 *
 * @param filteredContext The filtered notebook context (from `filterNotebookContext`)
 * @param allCells All cells in the notebook
 * @returns Array of cells to include in the context
 */
export function getCellsToInclude(
	filteredContext: positron.notebooks.NotebookContext,
	allCells: positron.notebooks.NotebookCell[]
): positron.notebooks.NotebookCell[] {
	// If filtered context has allCells, use those
	if (filteredContext.allCells && filteredContext.allCells.length > 0) {
		return filteredContext.allCells;
	}

	// For large notebooks without selection, filterNotebookContext sets allCells to undefined
	// In that case, use a sliding window around recent executed cells
	if (allCells.length >= MAX_CELLS_FOR_ALL_CELLS_CONTEXT && filteredContext.selectedCells.length === 0) {
		const codeCells = allCells.filter(c => c.type === positron.notebooks.NotebookCellType.Code);
		const executedCells = codeCells.filter(c => c.executionOrder !== undefined);

		if (executedCells.length > 0) {
			const lastExecutedIndex = Math.max(...executedCells.map(c => c.index));
			const { startIndex, endIndex } = calculateSlidingWindow(allCells.length, lastExecutedIndex);
			return allCells.slice(startIndex, endIndex);
		} else {
			// No executed cells, use first 20 cells
			return allCells.slice(0, MAX_CELLS_FOR_ALL_CELLS_CONTEXT);
		}
	}

	// Fallback: use all cells (shouldn't happen, but safe fallback)
	return allCells;
}
