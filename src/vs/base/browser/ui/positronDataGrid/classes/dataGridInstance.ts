/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IDataColumn } from 'vs/base/browser/ui/positronDataGrid/interfaces/dataColumn';
import { IColumnSortKey } from 'vs/base/browser/ui/positronDataGrid/interfaces/columnSortKey';

/**
 * ColumnHeaderOptions type.
 */
type ColumnHeaderOptions = | {
	readonly columnHeaders: false;
	readonly columnHeadersHeight?: never;
} | {
	readonly columnHeaders: true;
	readonly columnHeadersHeight: number;
};

/**
 * RowHeaderOptions type.
 */
type RowHeaderOptions = | {
	readonly rowHeaders: false;
	readonly rowHeadersWidth?: never;
	readonly rowHeadersResize?: never;
} | {
	readonly rowHeaders: true;
	readonly rowHeadersWidth: number;
	readonly rowHeadersResize: boolean;
};

/**
 * DefaultSizeOptions type.
 */
type DefaultSizeOptions = | {
	readonly defaultColumnWidth: number;
	readonly defaultRowHeight: number;
};

/**
 * ColumnResizeOptions type.
 */
type ColumnResizeOptions = | {
	readonly columnResize: false;
	readonly minimumColumnWidth?: never;
} | {
	readonly columnResize: true;
	readonly minimumColumnWidth: number;
};

/**
 * RowResizeOptions type.
 */
type RowResizeOptions = | {
	readonly rowResize: false;
	readonly minimumRowHeight?: never;
} | {
	readonly rowResize: true;
	readonly minimumRowHeight: number;
};

/**
 * ScrollbarOptions type.
 */
type ScrollbarOptions = | {
	readonly horizontalScrollbar: false;
	readonly verticalScrollbar: false;
	readonly scrollbarWidth?: never;
} | {
	readonly horizontalScrollbar: true;
	readonly verticalScrollbar: false;
	readonly scrollbarWidth: number;
} | {
	readonly horizontalScrollbar: false;
	readonly verticalScrollbar: true;
	readonly scrollbarWidth: number;
} | {
	readonly horizontalScrollbar: true;
	readonly verticalScrollbar: true;
	readonly scrollbarWidth: number;
};

/**
 * DisplayOptions type.
 */
type DisplayOptions = {
	cellBorder: boolean;
};

/**
 * DataGridOptions type.
 */
type DataGridOptions =
	ColumnHeaderOptions &
	RowHeaderOptions &
	DefaultSizeOptions &
	ColumnResizeOptions &
	RowResizeOptions &
	ScrollbarOptions &
	DisplayOptions;

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
 * ColumnSelectionRange interface.
 */
interface ColumnSelectionRange {
	firstColumnIndex: number;
	lastColumnIndex: number;
}

/**
 * RowSelectionRange interface.
 */
interface RowSelectionRange {
	firstRowIndex: number;
	lastRowIndex: number;
}

/**
 * CellSelectionRange interface.
 */
interface CellSelectionRange {
	firstColumnIndex: number;
	firstRowIndex: number;
	lastColumnIndex: number;
	lastRowIndex: number;
}

/**
 * ColumnSortKey class.
 */
class ColumnSortKey implements IColumnSortKey {
	//#region Private Properties

	/**
	 * Gets or sets the sort index.
	 */
	private _sortIndex: number;

	/**
	 * Gets or sets the column index.
	 */
	private _columnIndex: number;

	/**
	 * Gets or sets the the sort order; true for ascending, false for descending.
	 */
	private _ascending: boolean;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constuctor.
	 * @param sortIndex The sort index.
	 * @param columnIndex The column index.
	 * @param ascending The the sort order; true for ascending, false for descending.
	 */
	constructor(sortIndex: number, columnIndex: number, ascending: boolean) {
		this._sortIndex = sortIndex;
		this._columnIndex = columnIndex;
		this._ascending = ascending;
	}

	//#endregion Constructor

	//#region IColumnSortKey Implementation

	/**
	 * Gets the sort index.
	 */
	get sortIndex() {
		return this._sortIndex;
	}

	/**
	 * Gets the column index.
	 */
	get columnIndex() {
		return this._columnIndex;
	}

	/**
	 * Gets the sort order; true for ascending, false for descending.
	 */
	get ascending() {
		return this._ascending;
	}

	//#endregion IColumnSortKey Implementation

	//#region Public Properties

	/**
	 * Sets the sort index.
	 */
	set sortIndex(sortIndex: number) {
		this._sortIndex = sortIndex;
	}

	/**
	 * Sets the sort order; true for ascending, false for descending.
	 */
	set ascending(ascending: boolean) {
		this._ascending = ascending;
	}

	//#endregion Public Properties
}

/**
 * DataGridInstance class.
 */
export abstract class DataGridInstance extends Disposable {
	//#region Private Properties

	/**
	 * Gets a value which indicates whether to show column headers.
	 */
	private readonly _columnHeaders: boolean;

	/**
	 * Gets the column headers height.
	 */
	private readonly _columnHeadersHeight: number;

	/**
	 * Gets a value which indicates whether to show row headers.
	 */
	private readonly _rowHeaders: boolean;

	/**
	 * Gets or sets the row headers width.
	 */
	private _rowHeadersWidth: number;

	/**
	 * Gets a value which indicates whether to enable row headers resize.
	 */
	private readonly _rowHeadersResize: boolean;

	/**
	 * Gets a value which indicates whether to enable column resize.
	 */
	private readonly _columnResize: boolean;

	/**
	 * Gets the minimum column width.
	 */
	private readonly _minimumColumnWidth: number;

	/**
	 * Gets the default column width.
	 */
	private readonly _defaultColumnWidth: number;

	/**
	 * Gets a value which indicates whether to enable row resize.
	 */
	private readonly _rowResize: boolean;

	/**
	 * Gets the minimum row height.
	 */
	private readonly _minimumRowHeight: number;

	/**
	 * Gets the default row height.
	 */
	private readonly _defaultRowHeight: number;

	/**
	 * Gets a value which indicates whether to show the horizontal scrollbar.
	 */
	private readonly _horizontalScrollbar: boolean;

	/**
	 * Gets a value which indicates whether to show the vertical scrollbar.
	 */
	private readonly _verticalScrollbar: boolean;

	/**
	 * Gets the scrollbar width.
	 */
	private readonly _scrollbarWidth: number;

	/**
	 * Gets the column widths.
	 */
	private readonly _columnWidths = new Map<number, number>();

	/**
	 * Gets the row heights.
	 */
	private readonly _rowHeights = new Map<number, number>();

	/**
	 * Gets the column sort keys.
	 */
	private readonly _columnSortKeys = new Map<number, ColumnSortKey>();

	/**
	 * Gets or sets the width.
	 */
	private _width = 0;

	/**
	 * Gets or sets the height.
	 */
	private _height = 0;

	/**
	 * Gets or sets the first column index.
	 */
	protected _firstColumnIndex = 0;

	/**
	 * Gets or sets the first row index.
	 */
	protected _firstRowIndex = 0;

	/**
	 * Gets or sets the cursor column index.
	 */
	private _cursorColumnIndex = 0;

	/**
	 * Gets or sets the cursor row index.
	 */
	private _cursorRowIndex = 0;

	/**
	 * Gets or sets the cell selection range.
	 */
	private _cellSelectionRange?: CellSelectionRange;

	/**
	 * Gets or sets the column selection range.
	 */
	private _columnSelectionRange?: ColumnSelectionRange;

	/**
	 * Gets the column selection indexes.
	 */
	private readonly _columnSelectionIndexes = new Set<number>();

	/**
	 * Gets or sets the row selection range.
	 */
	private _rowSelectionRange?: RowSelectionRange;

	/**
	 * Gets the row selection indexes.
	 */
	private readonly _rowSelectionIndexes = new Set<number>();

	/**
	 * The onDidUpdate event emitter.
	 */
	protected readonly _onDidUpdateEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param options The options.
	 */
	constructor(options: DataGridOptions) {
		// Call the base class's constructor.
		super();

		// Set the options.
		this._columnHeaders = options.columnHeaders || false;
		this._columnHeadersHeight = this._columnHeaders ? options.columnHeadersHeight ?? 0 : 0;

		this._rowHeaders = options.rowHeaders || false;
		this._rowHeadersWidth = this._rowHeaders ? options.rowHeadersWidth ?? 0 : 0;
		this._rowHeadersResize = this._rowHeaders ? options.rowHeadersResize ?? false : false;

		this._defaultColumnWidth = options.defaultColumnWidth;
		this._defaultRowHeight = options.defaultRowHeight;

		this._columnResize = options.columnResize || false;
		this._minimumColumnWidth = options.minimumColumnWidth ?? 0;

		this._rowResize = options.rowResize || false;
		this._minimumRowHeight = options.minimumRowHeight ?? 0;

		this._horizontalScrollbar = options.horizontalScrollbar || false;
		this._verticalScrollbar = options.verticalScrollbar || false;
		this._scrollbarWidth = options.scrollbarWidth ?? 0;
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets a value which indicates whether to display column headers.
	 */
	get columnHeaders() {
		return this._columnHeaders;
	}

	/**
	 * Gets the column headers height.
	 */
	get columnHeadersHeight() {
		return this._columnHeadersHeight;
	}

	/**
	 * Gets a value which indicates whether to display row headers.
	 */
	get rowHeaders() {
		return this._rowHeaders;
	}

	/**
	 * Gets the row headers width.
	 */
	get rowHeadersWidth() {
		return this._rowHeadersWidth;
	}

	/**
	 * Gets a value which indicates whether to enable row headers resize.
	 */
	get rowHeadersResize() {
		return this._rowHeadersResize;
	}

	/**
	 * Gets a value which indicates whether to enable column resize.
	 */
	get columnResize() {
		return this._columnResize;
	}

	/**
	 * Gets the minimum column width.
	 */
	get minimumColumnWidth() {
		return this._minimumColumnWidth;
	}

	/**
	 * Gets the default column width.
	 */
	get defaultColumnWidth() {
		return this._defaultColumnWidth;
	}

	/**
	 * Gets a value which indicates whether to enable row resize.
	 */
	get rowResize() {
		return this._rowResize;
	}

	/**
	 * Gets the minimum row height.
	 */
	get minimumRowHeight() {
		return this._minimumRowHeight;
	}

	/**
	 * Gets the defailt row height.
	 */
	get defaultRowHeight() {
		return this._defaultRowHeight;
	}

	/**
	 * Gets a value which indicates whether to show the horizontal scrollbar.
	 */
	get horizontalScrollbar() {
		return this._horizontalScrollbar;
	}

	/**
	 * Gets a value which indicates whether to show the vertical scrollbar.
	 */
	get verticalScrollbar() {
		return this._verticalScrollbar;
	}

	/**
	 * Gets the scrollbar width.
	 */
	get scrollbarWidth() {
		return this._scrollbarWidth;
	}

	/**
	 * Gets the number of columns.
	 */
	abstract get columns(): number;

	/**
	 * Gets the number of rows.
	 */
	abstract get rows(): number;

	/**
	 * Gets the layout width.
	 */
	get layoutWidth() {
		// Calculate the layout width.
		let layoutWidth = this._width - this._rowHeadersWidth;
		if (this._verticalScrollbar) {
			layoutWidth -= this._scrollbarWidth;
		}

		// Done.
		return layoutWidth;
	}

	/**
	 * Gets the layout height.
	 */
	get layoutHeight() {
		// Calculate the layout height.
		let layoutHeight = this._height - this._columnHeadersHeight;
		if (this._horizontalScrollbar) {
			layoutHeight -= this._scrollbarWidth;
		}

		// Done.
		return layoutHeight;
	}

	/**
	 * Gets the visible columns.
	 */
	get visibleColumns() {
		// Calculate the visible columns.
		let visibleColumns = 0;
		let columnIndex = this._firstColumnIndex;
		let availableLayoutWidth = this.layoutWidth;
		while (columnIndex < this.columns) {
			// Get the column width.
			const columnWidth = this.getColumnWidth(columnIndex);

			// If the column width would exceed the available layout width, break out of the loop.
			if (columnWidth > availableLayoutWidth) {
				break;
			}

			// Increment the visible columns and the column index.
			visibleColumns++;
			columnIndex++;

			// Adjust the available layout width.
			availableLayoutWidth -= columnWidth;
		}

		// Done.
		return Math.max(visibleColumns, 1);
	}

	/**
	 * Gets the visible rows.
	 */
	get visibleRows() {
		// Calculate the visible rows.
		let visibleRows = 0;
		let rowIndex = this._firstRowIndex;
		let availableLayoutHeight = this.layoutHeight;
		while (rowIndex < this.rows) {
			// Get the row height.
			const rowHeight = this.getRowHeight(rowIndex);

			// If the row height would exceed the available layout height, break out of the loop.
			if (rowHeight > availableLayoutHeight) {
				break;
			}

			// Increment the visible rows and the row index.
			visibleRows++;
			rowIndex++;

			// Adjust the available layout height.
			availableLayoutHeight -= rowHeight;
		}

		// Done.
		return Math.max(visibleRows, 1);
	}

	/**
	 * Gets the maximum first column.
	 */
	get maximumFirstColumnIndex() {
		// When there are no columns, return 0.
		if (!this.columns) {
			return 0;
		}

		// Calculate the maximum first column by looking backward through the columns for the last
		// column that fits.
		let layoutWidth = this.layoutWidth - this.getColumnWidth(this.columns - 1);
		let maximumFirstColumn = this.columns - 1;
		for (let columnIndex = maximumFirstColumn - 1; columnIndex >= 0; columnIndex--) {
			const columnWidth = this.getColumnWidth(columnIndex);
			if (columnWidth < layoutWidth) {
				layoutWidth -= columnWidth;
				maximumFirstColumn--;
			} else {
				break;
			}
		}

		// Done.
		return maximumFirstColumn;
	}

	/**
	 * Gets the maximum first row.
	 */
	get maximumFirstRowIndex() {
		// When there are no rows, return 0.
		if (!this.rows) {
			return 0;
		}

		// Calculate the maximum first row by looking backward through the rows for the last row
		// that fits.
		let layoutHeight = this.layoutHeight - this.getRowHeight(this.rows - 1);
		let maximumFirstRow = this.rows - 1;
		for (let rowIndex = maximumFirstRow - 1; rowIndex >= 0; rowIndex--) {
			const rowHeight = this.getRowHeight(rowIndex);
			if (rowHeight < layoutHeight) {
				layoutHeight -= rowHeight;
				maximumFirstRow--;
			} else {
				break;
			}
		}

		// Done.
		return maximumFirstRow;
	}

	/**
	 * Gets the first column index.
	 */
	get firstColumnIndex() {
		return this._firstColumnIndex;
	}

	/**
	 * Gets the first row index.
	 */
	get firstRowIndex() {
		return this._firstRowIndex;
	}

	/**
	 * Gets the cursor column index.
	 */
	get cursorColumnIndex() {
		return this._cursorColumnIndex;
	}

	/**
	 * Gets the cursor row index.
	 */
	get cursorRowIndex() {
		return this._cursorRowIndex;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Gets the the width of a column.
	 * @param columnIndex The column index.
	 */
	getColumnWidth(columnIndex: number): number {
		const columnWidth = this._columnWidths.get(columnIndex);
		if (columnWidth !== undefined) {
			return columnWidth;
		} else {
			return this._defaultColumnWidth;
		}
	}

	/**
	 * Sets the width of a column.
	 * @param columnIndex The column index.
	 * @param columnWidth The column width.
	 */
	setColumnWidth(columnIndex: number, columnWidth: number) {
		// Get the current column width.
		const currentColumnWidth = this._columnWidths.get(columnIndex);
		if (currentColumnWidth !== undefined) {
			if (columnWidth === currentColumnWidth) {
				return;
			}
		}

		// Set the column width.
		this._columnWidths.set(columnIndex, columnWidth);

		// Fetch data.
		this.fetchData();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Gets the the height of a row.
	 * @param rowIndex The row index.
	 */
	getRowHeight(rowIndex: number) {
		const rowHeight = this._rowHeights.get(rowIndex);
		if (rowHeight !== undefined) {
			return rowHeight;
		} else {
			return this._defaultRowHeight;
		}
	}

	/**
	 * Sets the the height of a row.
	 * @param rowIndex The row index.
	 * @param rowHeight The row height.
	 */
	setRowHeight(rowIndex: number, rowHeight: number) {
		// Get the current row height.
		const currentRowHeight = this._rowHeights.get(rowIndex);
		if (currentRowHeight !== undefined) {
			if (rowHeight === currentRowHeight) {
				return;
			}
		}

		// Set the row height.
		this._rowHeights.set(rowIndex, rowHeight);

		// Fetch data.
		this.fetchData();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Sets a column sort key.
	 * @param columnIndex The column index.
	 * @param ascending The sort order; true for ascending, false for descending.
	 * @returns A Promise<void> that resolves when the sorting has completed.
	 */
	async setColumnSortKey(columnIndex: number, ascending: boolean): Promise<void> {
		// Get the column sort key for the column index.
		const columnSortKey = this._columnSortKeys.get(columnIndex);

		// Add or update the column sort key.
		if (!columnSortKey) {
			// Add the column sort key.
			this._columnSortKeys.set(
				columnIndex,
				new ColumnSortKey(this._columnSortKeys.size, columnIndex, ascending)
			);

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();

			// Sort the data.
			await this.doSortData();
		} else {
			// If the sort order has changed, update the column sort key.
			if (ascending !== columnSortKey.ascending) {
				// Update the sort order.
				columnSortKey.ascending = ascending;

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();

				// Sort the data.
				await this.doSortData();
			}
		}
	}

	/**
	 * Removes a column sort key.
	 * @param columnIndex The column index.
	 * @returns A Promise<void> that resolves when the sorting has completed.
	 */
	async removeColumnSortKey(columnIndex: number): Promise<void> {
		// Get the column sort key for the column index.
		const columnSortKey = this._columnSortKeys.get(columnIndex);

		// If there is a column sort key, remove it.
		if (columnSortKey) {
			// Remove the column sort key.
			this._columnSortKeys.delete(columnIndex);

			// Update the sort index of the remaining column sort keys that were added after the
			// column sort key that was removed.
			this._columnSortKeys.forEach(columnSortToUpdate => {
				if (columnSortToUpdate.sortIndex > columnSortKey.sortIndex) {
					columnSortToUpdate.sortIndex -= 1;
				}
			});

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();

			// Sort the data.
			await this.doSortData();
		}
	}

	/**
	 * Clears the column sort keys.
	 * @returns A Promise<void> that resolves when the sorting has completed.
	 */
	async clearColumnSortKeys(): Promise<void> {
		// Clear column sort keys.
		this._columnSortKeys.clear();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Sort the data.
		await this.doSortData();
	}

	/**
	 * Sets the row headers width.
	 * @param rowHeadersWidth The row headers width.
	 */
	setRowHeadersWidth(rowHeadersWidth: number) {
		// If the row headers width has changed, update it.
		if (rowHeadersWidth !== this._rowHeadersWidth) {
			// Set the row headers width..
			this._rowHeadersWidth = rowHeadersWidth;

			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the screen size.
	 * @param width The width.
	 * @param height The height.
	 */
	setScreenSize(width: number, height: number) {
		// A flag that is set to true when the screen size changed.
		let screenSizeChanged = false;

		// Set the width, if it changed.
		if (width !== this._width) {
			this._width = width;
			this.optimizeFirstColumn();
			screenSizeChanged = true;
		}

		// Set the height, if it changed.
		if (height !== this._height) {
			this._height = height;
			this.optimizeFirstRow();
			screenSizeChanged = true;
		}

		// If the screen size changed, fetch data and fire the onDidUpdate event.
		if (screenSizeChanged) {
			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the screen position.
	 * @param firstColumnIndex The first column index.
	 * @param firstRowIndex The first row index.
	 */
	setScreenPosition(firstColumnIndex: number, firstRowIndex: number) {
		if (firstColumnIndex !== this._firstColumnIndex || firstRowIndex !== this._firstRowIndex) {
			// Set the screen position.
			this._firstColumnIndex = firstColumnIndex;
			this._firstRowIndex = firstRowIndex;

			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the first column.
	 * @param firstColumnIndex The first column index.
	 */
	setFirstColumn(firstColumnIndex: number) {
		if (firstColumnIndex !== this._firstColumnIndex) {
			// Set the first column index.
			this._firstColumnIndex = firstColumnIndex;

			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the first row.
	 * @param firstRowIndex The first row index.
	 */
	setFirstRow(firstRowIndex: number) {
		if (firstRowIndex !== this._firstRowIndex) {
			// Set the first row index.
			this._firstRowIndex = firstRowIndex;

			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the cursor position.
	 * @param cursorColumnIndex The cursor column index.
	 * @param cursorRowIndex The cursor row index.
	 */
	setCursorPosition(cursorColumnIndex: number, cursorRowIndex: number) {
		if (cursorColumnIndex !== this._cursorColumnIndex ||
			cursorRowIndex !== this._cursorRowIndex
		) {
			// Set the cursor position.
			this._cursorColumnIndex = cursorColumnIndex;
			this._cursorRowIndex = cursorRowIndex;

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the cursor column.
	 * @param cursorColumnIndex The cursor column index.
	 */
	setCursorColumn(cursorColumnIndex: number) {
		if (cursorColumnIndex !== this._cursorColumnIndex) {
			// Set the cursor column.
			this._cursorColumnIndex = cursorColumnIndex;

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the cursor row.
	 * @param cursorRowIndex The cursor row index.
	 */
	setCursorRow(cursorRowIndex: number) {
		if (cursorRowIndex !== this._cursorRowIndex) {
			// Set the cursor row.
			this._cursorRowIndex = cursorRowIndex;

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Scrolls to the cursor.
	 */
	scrollToCursor() {
		this.scrollToCell(this._cursorColumnIndex, this._cursorRowIndex);
	}

	/**
	 * Scrolls to the specified cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 */
	scrollToCell(columnIndex: number, rowIndex: number) {
		this.scrollToColumn(columnIndex);
		this.scrollToRow(rowIndex);
	}

	/**
	 * Scrolls tp the specified column.
	 * @param columnIndex The column index.
	 */
	scrollToColumn(columnIndex: number) {
		if (columnIndex < this._firstColumnIndex) {
			this.setFirstColumn(columnIndex);
		} else if (columnIndex >= this._firstColumnIndex + this.visibleColumns) {
			do {
				this.setFirstColumn(this._firstColumnIndex + 1);
			} while (columnIndex >= this._firstColumnIndex + this.visibleColumns);
		}
	}

	/**
	 * Scrolls to the specified row.
	 * @param rowIndex The row index.
	 */
	scrollToRow(rowIndex: number) {
		if (rowIndex < this.firstRowIndex) {
			this.setFirstRow(rowIndex);
		} else if (rowIndex >= this.firstRowIndex + this.visibleRows) {
			do {
				this.setFirstRow(this.firstRowIndex + 1);
			} while (rowIndex >= this.firstRowIndex + this.visibleRows);
		}
	}

	/**
	 * Selects all.
	 */
	selectAll() {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear column selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes.clear();

		// Select all by selecting all rows.
		this._rowSelectionRange = {
			firstRowIndex: 0,
			lastRowIndex: this.rows - 1
		};
		this._rowSelectionIndexes.clear();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Mouse selects a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 */
	mouseSelectCell(columnIndex: number, rowIndex: number) {
		// Clear column selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes.clear();

		// Clear row selection.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes.clear();

		// If the cell is the cursor cell, remove the cell selection and scroll the cursor into
		// view. Otherwise, create a new cell selection range and scroll the cell into view.
		if (columnIndex === this._cursorColumnIndex && rowIndex === this._cursorRowIndex) {
			// Remove the cell selection.
			this._cellSelectionRange = undefined;

			// Scroll the cursor into view.
			this.scrollToCursor();
		} else {
			// Create a new cell selection range.
			this._cellSelectionRange = {
				firstColumnIndex: Math.min(this._cursorColumnIndex, columnIndex),
				firstRowIndex: Math.min(this._cursorRowIndex, rowIndex),
				lastColumnIndex: Math.max(this._cursorColumnIndex, columnIndex),
				lastRowIndex: Math.max(this._cursorRowIndex, rowIndex),
			};

			// Scroll the cell into view.
			this.scrollToCell(columnIndex, rowIndex);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Selects a column.
	 * @param columnIndex The column index.
	 */
	selectColumn(columnIndex: number) {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear row selection.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes.clear();

		// Single select the column.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes.clear();
		this._columnSelectionIndexes.add(columnIndex);

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Mouse selects a column.
	 * @param columnIndex The column index.
	 * @param selectionType The selection type.
	 */
	mouseSelectColumn(columnIndex: number, selectionType: MouseSelectionType) {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear row selection.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes.clear();

		/**
		 * Adjust the cursor position.
		 * @param columnIndex The column index.
		 */
		const adjustCursorPosition = (columnIndex: number) => {
			// Adjust the cursor position.
			this._cursorColumnIndex = columnIndex;
			this._cursorRowIndex = this._firstRowIndex;

			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		};

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Adjust the cursor position.
				adjustCursorPosition(columnIndex);

				// Single select the column.
				this._columnSelectionRange = undefined;
				this._columnSelectionIndexes.clear();
				this._columnSelectionIndexes.add(columnIndex);

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Multiple selection.
			case MouseSelectionType.Multi: {
				// If the column index is part of the column selection range, ignore the event.
				if (this._columnSelectionRange &&
					columnIndex >= this._columnSelectionRange.firstColumnIndex &&
					columnIndex <= this._columnSelectionRange.lastColumnIndex
				) {
					return;
				}

				// Toggle selection of the column index.
				if (!this._columnSelectionIndexes.has(columnIndex)) {
					// Adjust the cursor position.
					adjustCursorPosition(columnIndex);

					// Select the column index.
					this._columnSelectionIndexes.add(columnIndex);
				} else {
					// Unselect the column index.
					this._columnSelectionIndexes.delete(columnIndex);

					// Adjust the cursor position, if necessary.
					if (this._cursorColumnIndex === columnIndex) {
						if (this._columnSelectionIndexes.size) {
							adjustCursorPosition(Math.max(...this._columnSelectionIndexes));
						} else if (this._columnSelectionRange) {
							adjustCursorPosition(this._columnSelectionRange.lastColumnIndex);
						}
					}
				}

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Set the column selection range.
				this._columnSelectionRange = {
					firstColumnIndex: Math.min(this._cursorColumnIndex, columnIndex),
					lastColumnIndex: Math.max(this._cursorColumnIndex, columnIndex)
				};

				// Clear individually-selected columns.
				this._columnSelectionIndexes.clear();

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}
		}
	}

	/**
	 * Selects a row.
	 * @param rowIndex The row index.
	 */
	selectRow(rowIndex: number) {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear column selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes.clear();

		// Single select the row.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes.clear();
		this._rowSelectionIndexes.add(rowIndex);

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Selects a row.
	 * @param rowIndex The row index.
	 * @param selectionType The selection type.
	 */
	mouseSelectRow(rowIndex: number, selectionType: MouseSelectionType) {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear column selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes.clear();

		/**
		 * Adjust the row position.
		 * @param columnIndex The column index.
		 */
		const adjustRowPosition = (rowIndex: number) => {
			// Adjust the cursor position.
			this._cursorColumnIndex = this._firstColumnIndex;
			this._cursorRowIndex = rowIndex;

			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		};

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Adjust the cursor position.
				adjustRowPosition(rowIndex);

				// Single select the row.
				this._rowSelectionRange = undefined;
				this._rowSelectionIndexes.clear();
				this._rowSelectionIndexes.add(rowIndex);

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Multiple selection.
			case MouseSelectionType.Multi: {
				// If the row index is part of the row selection range, ignore the event.
				if (this._rowSelectionRange &&
					rowIndex >= this._rowSelectionRange.firstRowIndex &&
					rowIndex <= this._rowSelectionRange.lastRowIndex
				) {
					return;
				}

				// Toggle selection of the row index.
				if (!this._rowSelectionIndexes.has(rowIndex)) {
					// Adjust the cursor position.
					adjustRowPosition(rowIndex);

					// Select the row index.
					this._rowSelectionIndexes.add(rowIndex);
				} else {
					// Unselect the row index.
					this._rowSelectionIndexes.delete(rowIndex);

					// Adjust the cursor position, if necessary.
					if (this._cursorRowIndex === rowIndex) {
						if (this._rowSelectionIndexes.size) {
							adjustRowPosition(Math.max(...this._rowSelectionIndexes));
						} else if (this._rowSelectionRange) {
							adjustRowPosition(this._rowSelectionRange.lastRowIndex);
						}
					}
				}

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Set the row selection range.
				this._rowSelectionRange = {
					firstRowIndex: Math.min(this._cursorRowIndex, rowIndex),
					lastRowIndex: Math.max(this._cursorRowIndex, rowIndex)
				};

				// Clear individually-selected rows.
				this._rowSelectionIndexes.clear();

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}
		}
	}

	/**
	 * Extends column selection left.
	 * @param extendColumnSelectionBy A value that describes how to extend the column selection.
	 */
	extendColumnSelectionLeft(extendColumnSelectionBy: ExtendColumnSelectionBy) {
		// If there is a row selection, do nothing.
		if (this._rowSelectionRange || this._rowSelectionIndexes.size) {
			return;
		}

		// Process extend selection left based on what is currently selected.
		if (this._columnSelectionIndexes.size) {
			// Convert an individually selected column into a column selection range, if possible.
			if (this._columnSelectionIndexes.has(this._cursorColumnIndex)) {
				if (this._cursorColumnIndex > 0) {
					this._columnSelectionRange = {
						firstColumnIndex: this._cursorColumnIndex - 1,
						lastColumnIndex: this._cursorColumnIndex
					};
					this._columnSelectionIndexes.clear();
					this.scrollToColumn(this._columnSelectionRange.firstColumnIndex);
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._columnSelectionRange) {
			// Expand or contract the column selection range, if possible.
			if (this._cursorColumnIndex === this._columnSelectionRange.lastColumnIndex) {
				if (this._columnSelectionRange.firstColumnIndex > 0) {
					this._columnSelectionRange.firstColumnIndex--;
					this.scrollToColumn(this._columnSelectionRange.firstColumnIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorColumnIndex === this._columnSelectionRange.firstColumnIndex) {
				this._columnSelectionRange.lastColumnIndex--;
				this.scrollToColumn(this._columnSelectionRange.lastColumnIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cellSelectionRange) {
			// Expand or contract the cell selection range along the column axis, if possible.
			if (this._cursorColumnIndex === this._cellSelectionRange.lastColumnIndex) {
				if (this._cellSelectionRange.firstColumnIndex > 0) {
					this._cellSelectionRange.firstColumnIndex--;
					this.scrollToColumn(this._cellSelectionRange.firstColumnIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorColumnIndex === this._cellSelectionRange.firstColumnIndex) {
				this._cellSelectionRange.lastColumnIndex--;
				this.scrollToColumn(this._cellSelectionRange.lastColumnIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cursorColumnIndex > 0) {
			// Create a new cell selection range.
			this._cellSelectionRange = {
				firstColumnIndex: this._cursorColumnIndex - 1,
				firstRowIndex: this._cursorRowIndex,
				lastColumnIndex: this._cursorColumnIndex,
				lastRowIndex: this._cursorRowIndex
			};
			this.scrollToCell(this._cellSelectionRange.firstColumnIndex, this._cursorRowIndex);
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Extends column selection right.
	 * @param extendColumnSelectionBy A value that describes how to extend the column selection.
	 */
	extendColumnSelectionRight(extendColumnSelectionBy: ExtendColumnSelectionBy) {
		// If there is a row selection, do nothing.
		if (this._rowSelectionRange || this._rowSelectionIndexes.size) {
			return;
		}

		// Process extend selection right based on what is currently selected.
		if (this._columnSelectionIndexes.size) {
			// Convert an individually selected column into a column selection range, if possible.
			if (this._columnSelectionIndexes.has(this._cursorColumnIndex)) {
				if (this._cursorColumnIndex < this.columns - 1) {
					this._columnSelectionRange = {
						firstColumnIndex: this._cursorColumnIndex,
						lastColumnIndex: this._cursorColumnIndex + 1
					};
					this._columnSelectionIndexes.clear();
					this.scrollToColumn(this._columnSelectionRange.lastColumnIndex);
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._columnSelectionRange) {
			// Expand or contract the column selection range, if possible.
			if (this._cursorColumnIndex === this._columnSelectionRange.firstColumnIndex) {
				if (this._columnSelectionRange.lastColumnIndex < this.columns - 1) {
					this._columnSelectionRange.lastColumnIndex++;
					this.scrollToColumn(this._columnSelectionRange.lastColumnIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorColumnIndex === this._columnSelectionRange.lastColumnIndex) {
				this._columnSelectionRange.firstColumnIndex++;
				this.scrollToColumn(this._columnSelectionRange.firstColumnIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cellSelectionRange) {
			// Expand or contract the cell selection range along the column axis, if possible.
			if (this._cursorColumnIndex === this._cellSelectionRange.firstColumnIndex) {
				if (this._cellSelectionRange.lastColumnIndex < this.columns - 1) {
					this._cellSelectionRange.lastColumnIndex++;
					this.scrollToColumn(this._cellSelectionRange.lastColumnIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorColumnIndex === this._cellSelectionRange.lastColumnIndex) {
				this._cellSelectionRange.firstColumnIndex++;
				this.scrollToColumn(this._cellSelectionRange.firstColumnIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cursorColumnIndex < this.columns - 1) {
			// Create a new cell selection range.
			this._cellSelectionRange = {
				firstColumnIndex: this._cursorColumnIndex,
				firstRowIndex: this._cursorRowIndex,
				lastColumnIndex: this._cursorColumnIndex + 1,
				lastRowIndex: this._cursorRowIndex
			};
			this.scrollToCell(this._cellSelectionRange.lastColumnIndex, this._cursorRowIndex);
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Extends row selection up.
	 * @param extendRowSelectionBy A value that describes how to extend the row selection.
	 */
	extendRowSelectionUp(extendRowSelectionBy: ExtendRowSelectionBy) {
		// If there is a column selection, do nothing.
		if (this._columnSelectionRange || this._columnSelectionIndexes.size) {
			return;
		}

		// Process extend selection up based on what is currently selected.
		if (this._rowSelectionIndexes.size) {
			// Convert an individually selected row into a row selection range, if possible.
			if (this._rowSelectionIndexes.has(this._cursorRowIndex)) {
				if (this._cursorRowIndex > 0) {
					this._rowSelectionRange = {
						firstRowIndex: this._cursorRowIndex - 1,
						lastRowIndex: this._cursorRowIndex
					};
					this._rowSelectionIndexes.clear();
					this.scrollToRow(this._rowSelectionRange.firstRowIndex);
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._rowSelectionRange) {
			// Expand or contract the row selection range, if possible.
			if (this._cursorRowIndex === this._rowSelectionRange.lastRowIndex) {
				if (this._rowSelectionRange.firstRowIndex > 0) {
					this._rowSelectionRange.firstRowIndex--;
					this.scrollToRow(this._rowSelectionRange.firstRowIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorRowIndex === this._rowSelectionRange.firstRowIndex) {
				this._rowSelectionRange.lastRowIndex--;
				this.scrollToRow(this._rowSelectionRange.lastRowIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cellSelectionRange) {
			// Expand or contract the cell selection range along the row axis, if possible.
			if (this._cursorRowIndex === this._cellSelectionRange.lastRowIndex) {
				if (this._cellSelectionRange.firstRowIndex > 0) {
					this._cellSelectionRange.firstRowIndex--;
					this.scrollToRow(this._cellSelectionRange.firstRowIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorRowIndex === this._cellSelectionRange.firstRowIndex) {
				this._cellSelectionRange.lastRowIndex--;
				this.scrollToRow(this._cellSelectionRange.lastRowIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cursorRowIndex > 0) {
			// Create a new cell selection range.
			this._cellSelectionRange = {
				firstColumnIndex: this._cursorColumnIndex,
				firstRowIndex: this._cursorRowIndex - 1,
				lastColumnIndex: this._cursorColumnIndex,
				lastRowIndex: this._cursorRowIndex
			};
			this.scrollToCell(this._cursorColumnIndex, this._cellSelectionRange.firstRowIndex);
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Extends row selection down.
	 * @param extendRowSelectionBy A value that describes how to extend the row selection.
	 */
	extendRowSelectionDown(extendRowSelectionBy: ExtendRowSelectionBy) {
		// If there is a column selection, do nothing.
		if (this._columnSelectionRange || this._columnSelectionIndexes.size) {
			return;
		}

		// Process extend selection down based on what is currently selected.
		if (this._rowSelectionIndexes.size) {
			// Convert an individually selected row into a row selection range, if possible.
			if (this._rowSelectionIndexes.has(this._cursorRowIndex)) {
				if (this._cursorRowIndex < this.rows - 1) {
					this._rowSelectionRange = {
						firstRowIndex: this._cursorRowIndex,
						lastRowIndex: this._cursorRowIndex + 1
					};
					this._rowSelectionIndexes.clear();
					this.scrollToRow(this._rowSelectionRange.lastRowIndex);
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._rowSelectionRange) {
			// Expand or contract the row selection range, if possible.
			if (this._cursorRowIndex === this._rowSelectionRange.firstRowIndex) {
				if (this._rowSelectionRange.lastRowIndex < this.rows - 1) {
					this._rowSelectionRange.lastRowIndex++;
					this.scrollToRow(this._rowSelectionRange.lastRowIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorRowIndex === this._rowSelectionRange.lastRowIndex) {
				this._rowSelectionRange.firstRowIndex++;
				this.scrollToRow(this._rowSelectionRange.firstRowIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cellSelectionRange) {
			// Expand or contract the cell selection range along the row axis, if possible.
			if (this._cursorRowIndex === this._cellSelectionRange.firstRowIndex) {
				if (this._cellSelectionRange.lastRowIndex < this.rows - 1) {
					this._cellSelectionRange.lastRowIndex++;
					this.scrollToRow(this._cellSelectionRange.lastRowIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorRowIndex === this._cellSelectionRange.lastRowIndex) {
				this._cellSelectionRange.firstRowIndex++;
				this.scrollToRow(this._cellSelectionRange.firstRowIndex);
				this._onDidUpdateEmitter.fire();
			}
		} else if (this._cursorRowIndex < this.rows - 1) {
			// Create a new cell selection range.
			this._cellSelectionRange = {
				firstColumnIndex: this._cursorColumnIndex,
				firstRowIndex: this._cursorRowIndex,
				lastColumnIndex: this._cursorColumnIndex,
				lastRowIndex: this._cursorRowIndex + 1
			};
			this.scrollToCell(this._cursorColumnIndex, this._cellSelectionRange.lastRowIndex);
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Returns the cell selection state.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns A CellSelectionState that represents the cell selection state.
	 */
	cellSelectionState(columnIndex: number, rowIndex: number) {
		// If there isn't a cell selection range, return the column selection state and the row
		// selection state.
		if (!this._cellSelectionRange) {
			return this.columnSelectionState(columnIndex) | this.rowSelectionState(rowIndex);
		}

		// If the cell is selected, return the cell selection state.
		if (columnIndex >= this._cellSelectionRange.firstColumnIndex &&
			columnIndex <= this._cellSelectionRange.lastColumnIndex &&
			rowIndex >= this._cellSelectionRange.firstRowIndex &&
			rowIndex <= this._cellSelectionRange.lastRowIndex
		) {
			// Set the selected bit.
			let cellSelectionState = CellSelectionState.Selected;

			// If the column index is the first selected column index, set the selected left bit.
			if (columnIndex === this._cellSelectionRange.firstColumnIndex) {
				cellSelectionState |= CellSelectionState.SelectedLeft;
			}

			// If the column index is the last selected column index, set the selected right bit.
			if (columnIndex === this._cellSelectionRange.lastColumnIndex) {
				cellSelectionState |= CellSelectionState.SelectedRight;
			}

			// If the row index is the first selected row index, set the selected top bit.
			if (rowIndex === this._cellSelectionRange.firstRowIndex) {
				cellSelectionState |= CellSelectionState.SelectedTop;
			}

			// If the row index is the last selected row index, set the selected bottom bit.
			if (rowIndex === this._cellSelectionRange.lastRowIndex) {
				cellSelectionState |= CellSelectionState.SelectedBottom;
			}

			// Return the cell selection state.
			return cellSelectionState;
		}

		// The cell is not selected.
		return CellSelectionState.None;
	}

	/**
	 * Returns the column selection state.
	 * @param columnIndex The column index.
	 * @returns A SelectionState that represents the column selection state.
	 */
	columnSelectionState(columnIndex: number) {
		// If the column index is individually selected, return the appropriate selection state.
		if (this._columnSelectionIndexes.has(columnIndex)) {
			// The column index is selected.
			let selectionState = ColumnSelectionState.Selected;

			// See if the column index is the left selected column index in a range.
			if (!this._columnSelectionIndexes.has(columnIndex - 1)) {
				selectionState |= ColumnSelectionState.SelectedLeft;
			}

			// See if the column index is the right selected column index in a range.
			if (!this._columnSelectionIndexes.has(columnIndex + 1)) {
				selectionState |= ColumnSelectionState.SelectedRight;
			}

			// Return the selection state.
			return selectionState;
		}

		// See if the column index is in the column selection range.
		if (this._columnSelectionRange &&
			columnIndex >= this._columnSelectionRange.firstColumnIndex &&
			columnIndex <= this._columnSelectionRange.lastColumnIndex) {
			// The column index is selected.
			let selectionState = ColumnSelectionState.Selected;

			// See if the column index is the first selected column index.
			if (columnIndex === this._columnSelectionRange.firstColumnIndex) {
				selectionState |= ColumnSelectionState.SelectedLeft;
			}

			// See if the column index is the last selected column index.
			if (columnIndex === this._columnSelectionRange.lastColumnIndex) {
				selectionState |= ColumnSelectionState.SelectedRight;
			}

			// Return the selection state.
			return selectionState;
		}

		// The column is not selected.
		return ColumnSelectionState.None;
	}

	/**
	 * Returns the row selection state.
	 * @param rowIndex The row index.
	 * @returns A SelectionState that represents the row selection state.
	 */
	rowSelectionState(rowIndex: number) {
		// If the row index is individually selected, return the appropriate selection state.
		if (this._rowSelectionIndexes.has(rowIndex)) {
			// The row index is selected.
			let selectionState = RowSelectionState.Selected;

			// See if the row index is the first row index in a range.
			if (!this._rowSelectionIndexes.has(rowIndex - 1)) {
				selectionState |= RowSelectionState.SelectedTop;
			}

			// See if the row index is the last row index in a range.
			if (!this._rowSelectionIndexes.has(rowIndex + 1)) {
				selectionState |= RowSelectionState.SelectedBottom;
			}

			// Return the selection state.
			return selectionState;
		}

		// See if the row index is in the selection range.
		if (this._rowSelectionRange &&
			rowIndex >= this._rowSelectionRange.firstRowIndex &&
			rowIndex <= this._rowSelectionRange.lastRowIndex
		) {
			// The row index is selected.
			let selectionState = RowSelectionState.Selected;

			// See if the row index is the first selected row index.
			if (rowIndex === this._rowSelectionRange.firstRowIndex) {
				selectionState |= RowSelectionState.SelectedTop;
			}

			// See if the row index is the last selected row index.
			if (rowIndex === this._rowSelectionRange.lastRowIndex) {
				selectionState |= RowSelectionState.SelectedBottom;
			}

			// Return the selection state.
			return selectionState;
		}

		// The row is not selected.
		return RowSelectionState.None;
	}

	/**
	 * Clears selection.
	 */
	clearSelection() {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear column selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes.clear();

		// Clear row selection.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes.clear();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Returns a column sort key.
	 * @param columnIndex The column index.
	 * @returns An IColumnSortKey that represents the column sort.
	 */
	columnSortKey(columnIndex: number): IColumnSortKey | undefined {
		return this._columnSortKeys.get(columnIndex);
	}

	/**
	 * TODO.
	 */
	abstract initialize(): void;

	/**
	 * Sorts the data.
	 * @param columnSorts The array of column sorts.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	abstract sortData(columnSorts: IColumnSortKey[]): Promise<void>;

	/**
	 *
	 */
	abstract fetchData(): void;

	/**
	 * Gets a column.
	 * @param rowIndex The row index.
	 * @returns The row label.
	 */
	abstract column(columnIndex: number): IDataColumn | undefined;

	/**
	 * Gets a row header.
	 * @param rowIndex The row index.
	 * @returns The row header, or, undefined.
	 */
	abstract rowHeader(rowIndex: number): JSX.Element | undefined;

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The data cell, or, undefined.
	 */
	abstract cell(columnIndex: number, rowIndex: number): JSX.Element | undefined;

	/**
	 * onDidUpdate event.
	 */
	readonly onDidUpdate = this._onDidUpdateEmitter.event;

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Optimizes the first column.
	 */
	private optimizeFirstColumn() {
		// If the waffle isn't scrolled horizontally, return.
		if (!this.firstColumnIndex) {
			return;
		}

		// Calculate the layout width.
		let layoutWidth = this.layoutWidth;
		for (let i = this.firstColumnIndex; i < this.columns; i++) {
			// Adjust the layout width.
			layoutWidth -= this.getColumnWidth(i);

			// If the layout width has been exhausted, return.
			if (layoutWidth <= 0) {
				return;
			}
		}

		// See if we can optimize the first column.
		let firstColumnIndex: number | undefined = undefined;
		for (let i = this.firstColumnIndex - 1; i >= 0 && layoutWidth > 0; i--) {
			// Get the column width.
			const columnWidth = this.getColumnWidth(i);

			// If the column will fit, make it the first column index.
			if (columnWidth <= layoutWidth) {
				firstColumnIndex = i;
			}

			// Adjust the layout width.
			layoutWidth -= columnWidth;
		}

		// Set the first column, if it was adjusted.
		if (firstColumnIndex) {
			this._firstColumnIndex = firstColumnIndex;
		}
	}

	/**
	 * Optimizes the first row.
	 */
	private optimizeFirstRow() {
		// If the waffle isn't scrolled vertically, return.
		if (!this.firstRowIndex) {
			return;
		}

		// Calculate the layout height.
		let layoutHeight = this.layoutHeight;
		for (let i = this.firstRowIndex; i < this.rows; i++) {
			// Adjust the layout height.
			layoutHeight -= this.getRowHeight(i);

			// If the layout height has been exhausted, return.
			if (layoutHeight <= 0) {
				return;
			}
		}

		// See if we can optimize the first column.
		let firstRowIndex: number | undefined = undefined;
		for (let i = this.firstRowIndex - 1; i >= 0 && layoutHeight > 0; i--) {
			// Get the row height.
			const rowHeight = this.getRowHeight(i);

			// If the row will fit, make it the first row index.
			if (rowHeight <= layoutHeight) {
				firstRowIndex = i;
			}

			// Adjust the layout height.
			layoutHeight -= rowHeight;
		}

		// Set the first row, if it was adjusted.
		if (firstRowIndex) {
			this._firstRowIndex = firstRowIndex;
		}
	}

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	private async doSortData(): Promise<void> {
		// Get the column sorts.
		const columnSorts = Array.from(this._columnSortKeys.values()).sort((e1, e2) =>
			e1.sortIndex - e2.sortIndex
		);

		// Sort the data.
		await this.sortData(columnSorts);
	}

	//#endregion Private Methods
}
