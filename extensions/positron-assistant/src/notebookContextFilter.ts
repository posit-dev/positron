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
 * Maximum total characters for notebook context serialization.
 * Approximately 12K tokens (assuming ~4 chars per token).
 */
export const MAX_NOTEBOOK_CONTEXT_CHARS = 50_000;

/**
 * Maximum content length per non-selected cell when truncating.
 * Aggressive limit to ensure selected cells are preserved fully.
 */
export const MAX_NON_SELECTED_CELL_CONTENT_CHARS = 2_000;

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
 * Extended notebook cell interface that tracks truncation metadata.
 * Used internally to track when cell content has been truncated.
 */
interface TruncatedNotebookCell extends positron.notebooks.NotebookCell {
	/** Original content length before truncation, if truncation occurred */
	originalContentLength?: number;
}

/**
 * Type guard to check if a cell has truncation metadata.
 *
 * @param cell The cell to check
 * @returns True if the cell has originalContentLength property
 */
export function hasTruncationMetadata(cell: positron.notebooks.NotebookCell): cell is TruncatedNotebookCell {
	return 'originalContentLength' in cell;
}

/**
 * Gets the original content length from a cell if it was truncated.
 *
 * @param cell The cell to check
 * @returns The original content length, or undefined if not truncated
 */
export function getOriginalContentLength(cell: positron.notebooks.NotebookCell): number | undefined {
	return hasTruncationMetadata(cell) ? cell.originalContentLength : undefined;
}

/**
 * Truncates cell content to a maximum length, adding a truncation indicator.
 *
 * @param content The cell content to truncate
 * @param maxLength Maximum length for the content
 * @returns Truncated content with indicator, or original content if within limit
 */
function truncateCellContent(content: string, maxLength: number): string {
	if (content.length <= maxLength) {
		return content;
	}
	// Truncate and add indicator (accounting for indicator length)
	const truncationIndicator = '... [truncated]';
	const availableLength = maxLength - truncationIndicator.length;
	return content.substring(0, Math.max(0, availableLength)) + truncationIndicator;
}

/**
 * Estimates the total serialized size of cells when formatted as XML.
 * This is a rough estimate based on cell content length plus XML overhead.
 *
 * @param cells Array of notebook cells to estimate
 * @param selectedIndices Set of cell indices that are selected (preserved fully)
 * @param assumeTruncated If true, assumes non-selected cells are already truncated. Defaults to false.
 * @returns Estimated total character count for serialized output
 */
function estimateContextSize(
	cells: positron.notebooks.NotebookCell[],
	selectedIndices: Set<number>,
	assumeTruncated: boolean = false
): number {
	let totalSize = 0;
	// Base XML overhead per cell (tags, attributes, etc.) - rough estimate
	const XML_OVERHEAD_PER_CELL = 200;

	for (const cell of cells) {
		const isSelected = selectedIndices.has(cell.index);
		// Selected cells always use full content
		// Non-selected cells: use actual size if not assuming truncation, otherwise use truncated estimate
		const contentSize = isSelected
			? cell.content.length
			: (assumeTruncated
				? Math.min(cell.content.length, MAX_NON_SELECTED_CELL_CONTENT_CHARS)
				: cell.content.length);
		totalSize += contentSize + XML_OVERHEAD_PER_CELL;
	}

	return totalSize;
}

/**
 * Applies content budget limiting to cells, preserving selected cells fully
 * while truncating non-selected cells and potentially reducing cell count.
 *
 * @param cells Array of notebook cells to apply budget to
 * @param selectedIndices Set of cell indices that are selected (must be preserved)
 * @param budget Maximum total character budget
 * @returns Array of cells with content truncated as needed to fit budget
 */
function applyContentBudget(
	cells: positron.notebooks.NotebookCell[],
	selectedIndices: Set<number>,
	budget: number
): TruncatedNotebookCell[] {
	// First pass: truncate non-selected cell content
	const truncatedCells: TruncatedNotebookCell[] = cells.map(cell => {
		const isSelected = selectedIndices.has(cell.index);
		if (isSelected) {
			// Preserve selected cells fully
			return { ...cell };
		}

		// Truncate non-selected cells
		const originalLength = cell.content.length;
		const truncatedContent = truncateCellContent(cell.content, MAX_NON_SELECTED_CELL_CONTENT_CHARS);
		const truncated: TruncatedNotebookCell = {
			...cell,
			content: truncatedContent,
			originalContentLength: originalLength > truncatedContent.length ? originalLength : undefined
		};
		return truncated;
	});

	// Estimate size after truncation (assume truncated since we just truncated them)
	const currentSize = estimateContextSize(truncatedCells, selectedIndices, true);

	// If still over budget, reduce non-selected cells (but always keep selected cells)
	if (currentSize > budget) {
		// Separate selected and non-selected cells
		const selectedCells: TruncatedNotebookCell[] = [];
		const nonSelectedCells: TruncatedNotebookCell[] = [];

		for (const cell of truncatedCells) {
			if (selectedIndices.has(cell.index)) {
				selectedCells.push(cell);
			} else {
				nonSelectedCells.push(cell);
			}
		}

		// Calculate budget available for non-selected cells (they're already truncated)
		const selectedCellsSize = estimateContextSize(selectedCells, selectedIndices, false);
		const availableBudget = Math.max(0, budget - selectedCellsSize);

		// Keep non-selected cells that fit in remaining budget (they're already truncated)
		const keptNonSelectedCells: TruncatedNotebookCell[] = [];
		let usedBudget = 0;
		for (const cell of nonSelectedCells) {
			const cellSize = estimateContextSize([cell], new Set(), true);
			if (usedBudget + cellSize <= availableBudget) {
				keptNonSelectedCells.push(cell);
				usedBudget += cellSize;
			} else {
				// Stop adding cells once budget is exceeded
				break;
			}
		}

		// Combine selected cells (always included) with kept non-selected cells
		// Preserve original order by sorting by index
		const result = [...selectedCells, ...keptNonSelectedCells].sort((a, b) => a.index - b.index);
		return result;
	}

	return truncatedCells;
}

/**
 * Filters notebook context based on notebook size and selection state.
 *
 * Filtering rules:
 * - Small notebooks (<20 cells): Keep all cells
 * - Large notebooks (>=20 cells) with selection: Apply sliding window around last selected cell
 * - Large notebooks (>=20 cells) without selection: Remove allCells field
 *
 * Additionally applies content-aware size limiting to prevent exceeding character budget:
 * - Preserves selected cells fully
 * - Truncates non-selected cell content aggressively
 * - Reduces included cell count if still over budget
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
	const selectedIndices = new Set(context.selectedCells.map(cell => cell.index));

	// Small notebooks: keep all cells, but still apply content budget if needed
	if (totalCells < MAX_CELLS_FOR_ALL_CELLS_CONTEXT) {
		// Estimate total content size using actual content (not assuming truncation)
		const totalContentSize = estimateContextSize(context.allCells, selectedIndices, false);

		// If over budget, apply content-aware filtering
		if (totalContentSize > MAX_NOTEBOOK_CONTEXT_CHARS) {
			const budgetedCells = applyContentBudget(context.allCells, selectedIndices, MAX_NOTEBOOK_CONTEXT_CHARS);
			return {
				...context,
				allCells: budgetedCells
			};
		}

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

	let filteredCells = context.allCells.slice(startIndex, endIndex);

	// Update selectedIndices to only include cells that are actually in the filtered window
	const filteredSelectedIndices = new Set(
		filteredCells
			.filter(cell => selectedIndices.has(cell.index))
			.map(cell => cell.index)
	);

	// Apply content-aware budget limiting (use actual sizes, not assuming truncation)
	const totalContentSize = estimateContextSize(filteredCells, filteredSelectedIndices, false);
	if (totalContentSize > MAX_NOTEBOOK_CONTEXT_CHARS) {
		filteredCells = applyContentBudget(filteredCells, filteredSelectedIndices, MAX_NOTEBOOK_CONTEXT_CHARS);
	}

	return {
		...context,
		allCells: filteredCells
	};
}

