/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IColumnSortKey interface.
 */
export interface IColumnSortKey {
	/**
	 * Gets the sort index.
	 */
	readonly sortIndex: number;

	/**
	 * Gets the column index.
	 */
	readonly columnIndex: number;

	/**
	 * Gets the sort order; true for ascending, false for descending.
	 */
	readonly ascending: boolean;
}
