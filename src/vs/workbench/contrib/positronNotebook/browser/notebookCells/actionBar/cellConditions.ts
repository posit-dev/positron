/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellKind, IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';

/** The type of notebook cell */
/** The type of notebook cell */
export enum NotebookCellType {
	Code = 'code',
	Markdown = 'markdown',
	Raw = 'raw'
}

/**
 * Information about a cell's type and position within a notebook.
 * This is passed to cell condition predicates to determine if a command should be available.
 */
export interface ICellInfo {
	/** The type of cell: code, markdown, or raw */
	cellType: NotebookCellType;
	/** Zero-based index of the cell within the notebook */
	cellIndex: number;
	/** Total number of cells in the notebook */
	totalCells: number;
	/** Cell is first in the notebook */
	isFirstCell: boolean;
	/** Cell is last in the notebook */
	isLastCell: boolean;
	/** Cell is the only cell in the notebook */
	isOnlyCell: boolean;
	/** Cell is actively executing/running */
	isRunning: boolean;
	/** Cell is queued for execution */
	isPending: boolean;
}

/**
 * A predicate function that determines if a command should be available for a specific cell.
 * @param cellInfo Information about the cell's type and position
 * @returns True if the command should be available for this cell
 */
export type CellConditionPredicate = (cellInfo: ICellInfo) => boolean;

/**
 * Creates ICellInfo from a cell and its position in the notebook.
 * @param cell The notebook cell
 * @param totalCells Total number of cells in the notebook
 * @returns Cell information object
 */
export function createCellInfo(
	cell: IPositronNotebookCell,
	totalCells: number
): ICellInfo {
	const cellIndex = cell.index;
	return {
		cellType: cell.kind === CellKind.Code ? NotebookCellType.Code :
			cell.kind === CellKind.Markup ? NotebookCellType.Markdown : NotebookCellType.Raw,
		cellIndex,
		totalCells,
		isFirstCell: cellIndex === 0,
		isLastCell: cellIndex === totalCells - 1,
		isOnlyCell: totalCells === 1,
		// TODO: There is a tiny chance that the cell is running but the status is not yet updated.
		// If this happens we will probably need to make the cell info an observable.
		isRunning: cell.executionStatus.get() === 'running',
		isPending: cell.executionStatus.get() === 'pending',
	};
}

/**
 * Convenience condition builders for common cell filtering scenarios.
 */
export const CellConditions = {
	/** Only code cells */
	isCode: (info: ICellInfo) => info.cellType === 'code',

	/** Only markdown cells */
	isMarkdown: (info: ICellInfo) => info.cellType === 'markdown',

	/** Only raw cells */
	isRaw: (info: ICellInfo) => info.cellType === 'raw',

	/** Is running */
	isRunning: (info: ICellInfo) => info.isRunning,

	/** Is pending */
	isPending: (info: ICellInfo) => info.isPending,

	/** Not the first cell (has cells above) */
	notFirst: (info: ICellInfo) => !info.isFirstCell,

	/** Not the last cell (has cells below) */
	notLast: (info: ICellInfo) => !info.isLastCell,

	/** Not the only cell (has other cells) */
	notOnly: (info: ICellInfo) => !info.isOnlyCell,

	/** Is the first cell */
	isFirst: (info: ICellInfo) => info.isFirstCell,

	/** Is the last cell */
	isLast: (info: ICellInfo) => info.isLastCell,

	/** Is the only cell */
	isOnly: (info: ICellInfo) => info.isOnlyCell,

	/**
	 * Combines multiple predicates with AND logic.
	 * All predicates must return true for the condition to pass.
	 */
	and: (...predicates: CellConditionPredicate[]): CellConditionPredicate =>
		(info: ICellInfo) => predicates.every(p => p(info)),

	/**
	 * Combines multiple predicates with OR logic.
	 * At least one predicate must return true for the condition to pass.
	 */
	or: (...predicates: CellConditionPredicate[]): CellConditionPredicate =>
		(info: ICellInfo) => predicates.some(p => p(info)),

	/**
	 * Negates a predicate.
	 * Returns true when the predicate returns false.
	 */
	not: (predicate: CellConditionPredicate): CellConditionPredicate =>
		(info: ICellInfo) => !predicate(info)
};
