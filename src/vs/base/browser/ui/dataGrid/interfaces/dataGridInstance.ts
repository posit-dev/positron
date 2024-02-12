/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDataColumn } from 'vs/base/browser/ui/dataGrid/interfaces/dataColumn';
import { IColumnSortKey } from 'vs/base/browser/ui/dataGrid/interfaces/columnSortKey';

/**
 * ExtendColumnSelectionBy enumeration.
 */
export enum ExtendColumnSelectionBy {
	Column = 'column',
	Page = 'page',
	Screen = 'screen'
}

/**
 * ExtendRowSelectionBy enumeration.
 */
export enum ExtendRowSelectionBy {
	Row = 'row',
	Page = 'page',
	Screen = 'screen'
}

/**
 * CellSelectionState enumeration.
 */
export enum CellSelectionState {
	None = 0,
	Selected = 1,
	SelectedLeft = 2,
	SelectedRight = 4,
	SelectedTop = 8,
	SelectedBottom = 16
}

/**
 * ColumnSelectionState enumeration.
 */
export enum ColumnSelectionState {
	None = 0,
	Selected = 1,
	SelectedLeft = 2,
	SelectedRight = 4
}

/**
 * RowSelectionState enumeration.
 */
export enum RowSelectionState {
	None = 0,
	Selected = 1,
	SelectedTop = 8,
	SelectedBottom = 16
}

/**
 * MouseSelectionType enumeration.
 */
export enum MouseSelectionType {
	Single = 'single',
	Range = 'range',
	Multi = 'multi'
}

/**
 * IDataGridInstance interface.
 */
export interface IDataGridInstance {
	/**
	 * Gets the column headers height.
	 */
	readonly columnHeadersHeight: number;

	/**
	 * Gets the row headers width.
	 */
	readonly rowHeadersWidth: number;

	/**
	 * Gets the minimum column width.
	 */
	readonly minimumColumnWidth: number;

	/**
	 * Gets the default column width.
	 */
	readonly defaultColumnWidth: number;

	/**
	 * Gets the minimum row height.
	 */
	readonly minimumRowHeight: number;

	/**
	 * Gets the default row height.
	 */
	readonly defaultRowHeight: number;

	/**
	 * Gets the scrollbar width.
	 */
	readonly scrollbarWidth: number;

	/**
	 * Gets the number of columns.
	 */
	readonly columns: number;

	/**
	 * Gets the number of rows.
	 */
	readonly rows: number;

	/**
	 * Gets the layout width.
	 */
	readonly layoutWidth: number;

	/**
	 * Gets the layout height.
	 */
	readonly layoutHeight: number;

	/**
	 * Gets the visible columns.
	 */
	readonly visibleColumns: number;

	/**
	 * Gets the visible rows.
	 */
	readonly visibleRows: number;

	/**
	 * Gets the maximum first column index.
	 */
	readonly maximumFirstColumnIndex: number;

	/**
	 * Gets the maximum first row index.
	 */
	readonly maximumFirstRowIndex: number;

	/**
	 * Gets or sets the first column index.
	 */
	readonly firstColumnIndex: number;

	/**
	 * Gets or sets the first row index.
	 */
	readonly firstRowIndex: number;

	/**
	 * Gets the cursor column index.
	 */
	readonly cursorColumnIndex: number;

	/**
	 * Gets the cursor row.
	 */
	readonly cursorRowIndex: number;

	/**
	 * Sets the columns.
	 * @param columns The columns.
	 */
	setColumns(columns: IDataColumn[]): void;

	/**
	 * Gets the the width of a column.
	 * @param columnIndex The column index.
	 */
	getColumnWidth(columnIndex: number): number;

	/**
	 * Sets the width of a column.
	 * @param columnIndex The column index.
	 * @param columnWidth The column width.
	 */
	setColumnWidth(columnIndex: number, columnWidth: number): void;

	/**
	 * Sets a column sort key.
	 * @param columnIndex The column index.
	 * @param ascending The sort order; true for ascending, false for descending.
	 * @returns A Promise<void> that resolves when the sorting has completed.
	 */
	setColumnSortKey(columnIndex: number, ascending: boolean): Promise<void>;

	/**
	 * Removes a column sort key.
	 * @param columnIndex The column index.
	 * @returns A Promise<void> that resolves when the sorting has completed.
	 */
	removeColumnSortKey(columnIndex: number): Promise<void>;

	/**
	 * Clears the column sort keys.
	 * @returns A Promise<void> that resolves when the sorting has completed.
	 */
	clearColumnSortKeys(): Promise<void>;

	/**
	 * Sets the row headers width.
	 * @param rowHeadersWidth The row headers width.
	 */
	setRowHeadersWidth(rowHeadersWidth: number): void;

	/**
	 * Gets the the height of a row.
	 * @param rowIndex The row index.
	 * @returns The row height.
	 */
	getRowHeight(rowIndex: number): number;

	/**
	 * Sets the the height of a row.
	 * @param rowIndex The row index.
	 * @param rowHeight The row height.
	 */
	setRowHeight(rowIndex: number, rowHeight: number): void;

	/**
	 * Sets the screen size.
	 * @param width The width.
	 * @param height The height.
	 */
	setScreenSize(width: number, height: number): void;

	/**
	 * Sets the screen position.
	 * @param firstColumnIndex The first column index.
	 * @param firstRowIndex The first row index.
	 */
	setScreenPosition(firstColumnIndex: number, firstRowIndex: number): void;

	/**
	 * Sets the first column index.
	 * @param firstColumnIndex The first column index.
	 */
	setFirstColumn(firstColumnIndex: number): void;

	/**
	 * Sets the first row index.
	 * @param firstRowIndex The first row.
	 */
	setFirstRow(firstRowIndex: number): void;

	/**
	 * Sets the cursor position.
	 * @param cursorColumnIndex The cursor column index.
	 * @param cursorRowIndex The cursor row index.
	 */
	setCursorPosition(cursorColumnIndex: number, cursorRowIndex: number): void;

	/**
	 * Sets the cursor column index.
	 * @param cursorColumnIndex The cursor column index.
	 */
	setCursorColumn(cursorColumnIndex: number): void;

	/**
	 * Sets the cursor row index.
	 * @param cursorRowIndex The cursor row index.
	 */
	setCursorRow(cursorRowIndex: number): void;

	/**
	 * Scrolls to the cursor.
	 */
	scrollToCursor(): void;

	/**
	 * Scrolls to the specified cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 */
	scrollToCell(columnIndex: number, rowIndex: number): void;

	/**
	 * Scrolls to the specified column.
	 * @param columnIndex The column index.
	 */
	scrollToColumn(columnIndex: number): void;

	/**
	 * Scrolls to the specified row.
	 * @param rowIndex The row index.
	 */
	scrollToRow(rowIndex: number): void;

	/**
	 * Selects all.
	 */
	selectAll(): void;

	/**
	 * Mouse selects a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @param mouseSelectionType The mouse selection type.
	 */
	mouseSelectCell(columnIndex: number, rowIndex: number): void;

	/**
	 * Selects a column.
	 * @param columnIndex The column index.
	 */
	selectColumn(columnIndex: number): void;

	/**
	 * Mouse selects a column.
	 * @param columnIndex The column index.
	 * @param mouseSelectionType The mouse selection type.
	 */
	mouseSelectColumn(columnIndex: number, mouseSelectionType: MouseSelectionType): void;

	/**
	 * Selects a row.
	 * @param rowIndex The row index.
	 */
	selectRow(rowIndex: number): void;

	/**
	 * Mouse selects a row.
	 * @param rowIndex The row index.
	 * @param mouseSelectionType The mouse selection mode.
	 */
	mouseSelectRow(rowIndex: number, mouseSelectionType: MouseSelectionType): void;

	/**
	 * Extends column selection left.
	 * @param extendColumnSelectionBy A value that describes how to extend the column selection.
	 */
	extendColumnSelectionLeft(extendColumnSelectionBy: ExtendColumnSelectionBy): void;

	/**
	 * Extends column selection right.
	 * @param extendColumnSelectionBy A value that describes how to extend the column selection.
	 */
	extendColumnSelectionRight(extendColumnSelectionBy: ExtendColumnSelectionBy): void;

	/**
	 * Extends row selection up.
	 * @param extendRowSelectionBy A value that describes how to extend the row selection.
	 */
	extendRowSelectionUp(extendRowSelectionBy: ExtendRowSelectionBy): void;

	/**
	 * Extends row selection down.
	 * @param extendRowSelectionBy A value that describes how to extend the row selection.
	 */
	extendRowSelectionDown(extendRowSelectionBy: ExtendRowSelectionBy): void;

	/**
	 * Returns a cell selection state.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns A CellSelectionState that represents the cell selection state.
	 */
	cellSelectionState(columnIndex: number, rowIndex: number): CellSelectionState;

	/**
	 * Returns a column selection state.
	 * @param columnIndex The column index.
	 * @returns A ColumnSelectionState that represents the column selection state.
	 */
	columnSelectionState(columnIndex: number): ColumnSelectionState;

	/**
	 * Returns a row selection state.
	 * @param rowIndex The row index.
	 * @returns A RowSelectionState that represents the row selection state.
	 */
	rowSelectionState(rowIndex: number): RowSelectionState;

	/**
	 * Clears selection.
	 */
	clearSelection(): void;

	/**
	 * Returns a column.
	 * @param columnIndex The column index.
	 * @returns An IDataColumn that represents the column.
	 */
	column(columnIndex: number): IDataColumn;

	/**
	 * Returns a column sort.
	 * @param columnIndex The column index.
	 * @returns A IColumnSortKey that represents the column sort key.
	 */
	columnSortKey(columnIndex: number): IColumnSortKey | undefined;

	/**
	 * Initialize.
	 */
	initialize(): void;

	/**
	 * Sorts the data.
	 * @param columnSorts The array of column sort keys.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	sortData(columnSorts: IColumnSortKey[]): Promise<void>;

	/**
	 * Fetches data.
	 */
	fetchData(): void;

	/**
	 * Gets a row label.
	 * @param rowIndex The row index.
	 * @returns The row label.
	 */
	rowLabel(rowIndex: number): string | undefined;

	/**
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): string | undefined;

	/**
	 * The onDidUpdate event.
	 */
	readonly onDidUpdate: Event<void>;
}
