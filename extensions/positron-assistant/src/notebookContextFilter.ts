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
export const MAX_CELLS_FOR_ALL_CELLS_CONTEXT = 20;

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

