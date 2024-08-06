/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IDataColumn } from 'vs/workbench/browser/positronDataGrid/interfaces/dataColumn';
import { IColumnSortKey } from 'vs/workbench/browser/positronDataGrid/interfaces/columnSortKey';
import { AnchorPoint } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';

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
	readonly defaultColumnWidth?: number;
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
type DisplayOptions = | {
	useEditorFont: boolean;
	automaticLayout: boolean;
	rowsMargin?: number;
	cellBorders?: boolean;
	cursorInitiallyHidden?: boolean;
};

/**
 * CursorOptions type.
 */
type CursorOptions = | {
	cursorInitiallyHidden?: boolean;
};

/**
 * DefaultCursorOptions type.
 */
type DefaultCursorOptions = | {
	internalCursor: false;
	cursorOffset?: never;
} | {
	internalCursor: true;
	cursorOffset: number;
};

/**
 * SelectionOptions type.
 */
type SelectionOptions = | {
	selection?: boolean;
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
	DisplayOptions &
	CursorOptions &
	DefaultCursorOptions &
	SelectionOptions;

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
 * CellSelectionRange interface.
 */
class CellSelectionRange {
	/**
	 * Constructor.
	 * @param firstColumnIndex The first column index.
	 * @param firstRowIndex The first row index.
	 * @param lastColumnIndex The last column index.
	 * @param lastRowIndex The last row index.
	 */
	constructor(
		public firstColumnIndex: number,
		public firstRowIndex: number,
		public lastColumnIndex: number,
		public lastRowIndex: number
	) { }

	/**
	 * Returns a value which indicates whether the specified column index and row index is contained
	 * in the cell selection range
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns true if the column index and row index is contained in the cell selection range;
	 * otherwise, false.
	 */
	contains(columnIndex: number, rowIndex: number) {
		return columnIndex >= this.firstColumnIndex && columnIndex <= this.lastColumnIndex &&
			rowIndex >= this.firstRowIndex && rowIndex <= this.lastRowIndex;
	}
}

/**
 * SelectionRange interface.
 */
class SelectionRange {
	/**
	 * Constructor.
	 * @param firstIndex The first index.
	 * @param lastIndex The last index.
	 */
	constructor(public firstIndex: number, public lastIndex: number) { }

	/**
	 * Returns a value which indicates whether the specified index is contained in the selection
	 * range.
	 * @param index The index.
	 * @returns true if the index is contained in the selection range; otherwise, false.
	 */
	contains(index: number) {
		return index >= this.firstIndex && index <= this.lastIndex;
	}

	indexes() {
		const indexes: number[] = [this.lastIndex - this.firstIndex];
		for (let index = this.firstIndex; index <= this.lastIndex; index++) {
			indexes.push(index);
		}

		return new SelectionIndexes(indexes);
	}
}

/**
 * SelectionIndexes class.
 */
class SelectionIndexes {
	/**
	 * Gets or sets the indexes.
	 */
	readonly indexes = new Set<number>();

	/**
	 * Constructor.
	 * @param indexes The initial indexes.
	 */
	constructor(indexes: number | number[]) {
		if (Array.isArray(indexes)) {
			indexes.forEach(index => this.indexes.add(index));
		} else {
			this.indexes.add(indexes);
		}
	}

	/**
	 * Determines whether the selection indexes has the specified index.
	 * @param index The index.
	 * @returns true, if the selection indexes has the specified index; otherwise, false.
	 */
	has(index: number) {
		return this.indexes.has(index);
	}

	/**
	 * Returns a value which indicates whether the selection indexes is empty.
	 * @returns true, if the selection indexes is empty; otherwise, false.
	 */
	isEmpty() {
		return this.indexes.size === 0;
	}

	/**
	 * Adds the specified index to the selection indexes.
	 * @param index The index.
	 */
	add(index: number) {
		this.indexes.add(index);
	}

	/**
	 * Deletes the specified index from the set of selection indexes.
	 * @param index The index.
	 */
	delete(index: number) {
		this.indexes.delete(index);
	}

	/**
	 * Returns the max selection index.
	 * @returns The max selection index.
	 */
	max() {
		return Math.max(...this.indexes);
	}

	/**
	 * Returns the selection indexes as a sorted array.
	 * @returns The selection indexes as a sorted array.
	 */
	sortedArray() {
		return Array.from(this.indexes).sort((a, b) => a - b);
	}
}

/**
 * ClipboardCell class.
 */
export class ClipboardCell {
	constructor(
		readonly columnIndex: number,
		readonly rowIndex: number
	) { }
}

/**
 * ClipboardCellRange class.
 */
export class ClipboardCellRange {
	constructor(
		readonly firstColumnIndex: number,
		readonly firstRowIndex: number,
		readonly lastColumnIndex: number,
		readonly lastRowIndex: number
	) { }
}

/**
 * ClipboardColumnRange class.
 */
export class ClipboardColumnRange {
	constructor(
		readonly firstColumnIndex: number,
		readonly lastColumnIndex: number,
	) { }
}

/**
 * ClipboardColumnIndexes class.
 */
export class ClipboardColumnIndexes {
	constructor(
		readonly indexes: number[]
	) { }
}

/**
 * ClipboardRowRange class.
 */
export class ClipboardRowRange {
	constructor(
		readonly firstRowIndex: number,
		readonly lastRowIndex: number,
	) { }
}

/**
 * ClipboardRowIndexes class.
 */
export class ClipboardRowIndexes {
	constructor(
		readonly indexes: number[]
	) { }
}

/**
 * ClipboardData type.
 */
export type ClipboardData =
	ClipboardCell |
	ClipboardCellRange |
	ClipboardColumnRange |
	ClipboardColumnIndexes |
	ClipboardRowRange |
	ClipboardRowIndexes;

/**
 * ColumnSortKeyDescriptor class.
 *
 * "Descriptor" added to disambiguate from ColumnSortKey in generated comm.
 */
export class ColumnSortKeyDescriptor implements IColumnSortKey {
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
	//#region Private Properties - Settings

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
	 * Gets a value which indicates whether to use the editor font to display data.
	 */
	private readonly _useEditorFont: boolean;

	/**
	 * Gets a value which indicates whether to perform automatic layout using a ResizeObserver.
	 */
	private readonly _automaticLayout: boolean;

	/**
	 * Gets the rows margin.
	 */
	private readonly _rowsMargin: number;

	/**
	 * Gets a value which indicates whether to show cell borders.
	 */
	private readonly _cellBorders: boolean;

	/**
	 * Gets or sets a value which indicates whether the cursor is initially hidden.
	 */
	private readonly _cursorInitiallyHidden: boolean;

	/**
	 * Gets a value which indicates whether to show the internal cursor.
	 */
	private readonly _internalCursor: boolean;

	/**
	 * Gets the cursor offset.
	 */
	private readonly _cursorOffset: number;

	/**
	 * Gets a value which indicates whether selection is enabled.
	 */
	private readonly _selection: boolean;

	//#endregion Private Properties - Settings

	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether the data grid is focused.
	 */
	private _focused = false;

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
	private _firstColumnIndex = 0;

	/**
	 * Gets or sets the first row index.
	 */
	private _firstRowIndex = 0;

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
	private _columnSelectionRange?: SelectionRange;

	/**
	 * Gets the column selection indexes.
	 */
	private _columnSelectionIndexes?: SelectionIndexes;

	/**
	 * Gets or sets the row selection range.
	 */
	private _rowSelectionRange?: SelectionRange;

	/**
	 * Gets the row selection indexes.
	 */
	private _rowSelectionIndexes?: SelectionIndexes;

	/**
	 * Gets the column widths.
	 */
	private readonly _columnWidths = new Map<number, number>();

	/**
	 * Gets the row heights.
	 */
	private readonly _rowHeights = new Map<number, number>();

	//#endregion Private Properties

	//#region Protected Properties

	/**
	 * Gets the column sort keys.
	 */
	protected readonly _columnSortKeys = new Map<number, ColumnSortKeyDescriptor>();

	//#endregion Protected Properties

	//#region Protected Events

	/**
	 * The onDidUpdate event emitter.
	 */
	protected readonly _onDidUpdateEmitter = this._register(new Emitter<void>);

	//#endregion Protected Events

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

		this._defaultColumnWidth = options.defaultColumnWidth ?? 0;
		this._defaultRowHeight = options.defaultRowHeight;

		this._columnResize = options.columnResize || false;
		this._minimumColumnWidth = options.minimumColumnWidth ?? this._defaultColumnWidth;

		this._rowResize = options.rowResize || false;
		this._minimumRowHeight = options.minimumRowHeight ?? options.defaultRowHeight;

		this._horizontalScrollbar = options.horizontalScrollbar || false;
		this._verticalScrollbar = options.verticalScrollbar || false;
		this._scrollbarWidth = options.scrollbarWidth ?? 0;

		this._useEditorFont = options.useEditorFont;
		this._automaticLayout = options.automaticLayout;
		this._rowsMargin = options.rowsMargin ?? 0;
		this._cellBorders = options.cellBorders ?? true;

		this._cursorInitiallyHidden = options.cursorInitiallyHidden ?? false;
		if (options.cursorInitiallyHidden) {
			this._cursorColumnIndex = -1;
			this._cursorRowIndex = -1;
		}

		this._internalCursor = options.internalCursor ?? true;
		this._cursorOffset = this._internalCursor ? options.cursorOffset ?? 0 : 0;

		this._selection = options.selection ?? true;
	}

	//#endregion Constructor & Dispose

	//#region Public Properties - Settings

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
	 * Gets a value which indicates whether to perform automatic layout using a ResizeObserver.
	 */
	get useEditorFont() {
		return this._useEditorFont;
	}

	/**
	 * Gets a value which indicates whether to perform automatic layout using a ResizeObserver.
	 */
	get automaticLayout() {
		return this._automaticLayout;
	}

	/**
	 * Gets the rows margin.
	 */
	get rowsMargin() {
		return this._rowsMargin;
	}

	/**
	 * Gets a value which indicates whether to show cell borders.
	 */
	get cellBorder() {
		return this._cellBorders;
	}

	/**
	 * Gets a value which indicates whether to show the internal cursor.
	 */
	get internalCursor() {
		return this._internalCursor;
	}

	/**
	 * Gets the cursor offset.
	 */
	get cursorOffset() {
		return this._cursorOffset;
	}

	/**
	 * Gets a value which indicates whether selection is enabled.
	 */
	get selection() {
		return this._selection;
	}

	//#endregion Public Properties - Settings

	//#region Public Properties

	/**
	 * Gets a value which indicates whether the data explorer is focused.
	 */
	get focused() {
		return this._focused;
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
	 * Gets the screen columns.
	 */
	get screenColumns() {
		return Math.ceil(this._width / this._minimumColumnWidth);
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
	 * Gets the screen rows.
	 */
	get screenRows() {
		return Math.ceil(this._height / this._minimumRowHeight);
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

	//#region Public Events

	/**
	 * onDidUpdate event.
	 */
	readonly onDidUpdate = this._onDidUpdateEmitter.event;

	//#endregion Public Events

	//#region Public Methods

	/**
	 * Sets the focused state of the data grid.
	 * @param focused A value which indicates whether the data grid is focused.
	 */
	setFocused(focused: boolean) {
		// Set the focused flag, if it changed.
		if (this._focused !== focused) {
			// Set the focused flag.
			this._focused = focused;

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Shows the cursor, if it was initially hidden.
	 */
	showCursor() {
		// Set the initial cursor position.
		if (this._cursorInitiallyHidden &&
			this._cursorColumnIndex === -1 &&
			this._cursorRowIndex === -1) {
			this.setCursorPosition(0, 0);
			// Return true, indicating that the cursor was shown.
			return true;
		}

		// Return false, indicating that the cursor was already showing.
		return false;
	}

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
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setColumnWidth(columnIndex: number, columnWidth: number): Promise<void> {
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
		await this.fetchData();

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
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setRowHeight(rowIndex: number, rowHeight: number): Promise<void> {
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
		await this.fetchData();

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
				new ColumnSortKeyDescriptor(this._columnSortKeys.size, columnIndex, ascending)
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
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setRowHeadersWidth(rowHeadersWidth: number): Promise<void> {
		// If the row headers width has changed, update it.
		if (rowHeadersWidth !== this._rowHeadersWidth) {
			// Set the row headers width..
			this._rowHeadersWidth = rowHeadersWidth;

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the screen size.
	 * @param width The width.
	 * @param height The height.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setScreenSize(width: number, height: number): Promise<void> {
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
			await this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the screen position.
	 * @param firstColumnIndex The first column index.
	 * @param firstRowIndex The first row index.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setScreenPosition(firstColumnIndex: number, firstRowIndex: number): Promise<void> {
		if (firstColumnIndex !== this._firstColumnIndex || firstRowIndex !== this._firstRowIndex) {
			// Set the screen position.
			this._firstColumnIndex = firstColumnIndex;
			this._firstRowIndex = firstRowIndex;

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the first column.
	 * @param firstColumnIndex The first column index.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setFirstColumn(firstColumnIndex: number): Promise<void> {
		if (firstColumnIndex !== this._firstColumnIndex) {
			// Set the first column index.
			this._firstColumnIndex = firstColumnIndex;

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sets the first row.
	 * @param firstRowIndex The first row index.
	 * @param force A value which indicates whether to force the operation.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setFirstRow(firstRowIndex: number, force: boolean = false): Promise<void> {
		// If the operation is being forced, or the first row has changed, set the first row and
		// update the data grid.
		if (force || firstRowIndex !== this._firstRowIndex) {
			// Set the first row index.
			this._firstRowIndex = firstRowIndex;

			// Fetch data.
			await this.fetchData();

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
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async scrollToCursor() {
		await this.scrollToCell(this._cursorColumnIndex, this._cursorRowIndex);
	}

	/**
	 * Scrolls to the specified cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async scrollToCell(columnIndex: number, rowIndex: number) {
		await this.scrollToColumn(columnIndex);
		await this.scrollToRow(rowIndex);
	}

	/**
	 * Scrolls tp the specified column.
	 * @param columnIndex The column index.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async scrollToColumn(columnIndex: number): Promise<void> {
		if (columnIndex < this._firstColumnIndex) {
			await this.setFirstColumn(columnIndex);
		} else if (columnIndex >= this._firstColumnIndex + this.visibleColumns) {
			do {
				await this.setFirstColumn(this._firstColumnIndex + 1);
			} while (columnIndex >= this._firstColumnIndex + this.visibleColumns);
		}
	}

	/**
	 * Scrolls to the specified row.
	 * @param rowIndex The row index.
	 */
	async scrollToRow(rowIndex: number) {
		if (rowIndex < this.firstRowIndex) {
			await this.setFirstRow(rowIndex);
		} else if (rowIndex >= this.firstRowIndex + this.visibleRows) {
			do {
				await this.setFirstRow(this.firstRowIndex + 1);
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
		this._columnSelectionIndexes = undefined;

		// Select all by selecting all rows. (We could have done this with selecting all columns.)
		this._rowSelectionIndexes = undefined;
		this._rowSelectionRange = new SelectionRange(0, this.rows - 1);

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Mouse selects a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @param selectionType The mouse selection type.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async mouseSelectCell(
		columnIndex: number,
		rowIndex: number,
		selectionType: MouseSelectionType
	) {
		// Clear column selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes = undefined;

		// Clear row selection.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes = undefined;

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Clear cell selection.
				this._cellSelectionRange = undefined;

				// Adjust the cursor and scroll to it.
				this.setCursorPosition(columnIndex, rowIndex);
				await this.scrollToCursor();

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Create a new cell selection range.
				this._cellSelectionRange = new CellSelectionRange(
					Math.min(this._cursorColumnIndex, columnIndex),
					Math.min(this._cursorRowIndex, rowIndex),
					Math.max(this._cursorColumnIndex, columnIndex),
					Math.max(this._cursorRowIndex, rowIndex),
				);

				// Scroll the cell into view.
				await this.scrollToCell(columnIndex, rowIndex);

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Multi selection.
			case MouseSelectionType.Multi: {
				// Not supported at this time. Do nothing.
				return;
			}
		}
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
		this._rowSelectionIndexes = undefined;

		// Single select the column.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes = new SelectionIndexes(columnIndex);

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Mouse selects a column.
	 * @param columnIndex The column index.
	 * @param selectionType The selection type.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async mouseSelectColumn(columnIndex: number, selectionType: MouseSelectionType): Promise<void> {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear row selection.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes = undefined;

		/**
		 * Adjusts the cursor.
		 * @param columnIndex The column index.
		 */
		const adjustCursor = async (columnIndex: number) => {
			// Adjust the cursor.
			this._cursorColumnIndex = columnIndex;
			this._cursorRowIndex = this._firstRowIndex;
		};

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Single select the column.
				this._columnSelectionRange = undefined;
				this._columnSelectionIndexes = new SelectionIndexes(columnIndex);

				// Adjust the cursor and update the waffle.
				await adjustCursor(columnIndex);
				await this.scrollToColumn(columnIndex);
				await this.fetchData();

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Clear individually-selected columns.
				this._columnSelectionIndexes = undefined;

				// Set the column selection range.
				this._columnSelectionRange = new SelectionRange(
					Math.min(this._cursorColumnIndex, columnIndex),
					Math.max(this._cursorColumnIndex, columnIndex)
				);

				// Update the waffle.
				await this.scrollToColumn(columnIndex);
				await this.fetchData();

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Multi selection.
			case MouseSelectionType.Multi: {
				// If the column index is part of the column selection range, ignore the event to
				// preserve the user's selection.
				if (this._columnSelectionRange?.contains(columnIndex)) {
					return;
				}

				// Multi select the column.
				if (this._columnSelectionIndexes?.has(columnIndex)) {
					// Unselect the column.
					this._columnSelectionIndexes.delete(columnIndex);
					if (this._columnSelectionIndexes.isEmpty()) {
						this._columnSelectionIndexes = undefined;
					}
				} else {
					// Select the column.
					if (this._columnSelectionIndexes) {
						this._columnSelectionIndexes.add(columnIndex);
					} else {
						if (!this._columnSelectionRange) {
							this._columnSelectionIndexes = new SelectionIndexes(columnIndex);
						} else {
							this._columnSelectionIndexes = this._columnSelectionRange.indexes();
							this._columnSelectionIndexes.add(columnIndex);
							this._columnSelectionRange = undefined;
						}
					}

					// Adjust the cursor and update the waffle.
					await adjustCursor(columnIndex);
					await this.scrollToColumn(columnIndex);
					await this.fetchData();
				}

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
		this._columnSelectionIndexes = undefined;

		// Single select the row.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes = new SelectionIndexes(rowIndex);

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Mouse selects a row.
	 * @param rowIndex The row index.
	 * @param selectionType The selection type.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async mouseSelectRow(rowIndex: number, selectionType: MouseSelectionType): Promise<void> {
		// Clear cell selection.
		this._cellSelectionRange = undefined;

		// Clear column selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes = undefined;

		/**
		 * Adjust the cursor.
		 * @param rowIndex The row index.
		 */
		const adjustCursor = async (rowIndex: number) => {
			// Adjust the cursor.
			this._cursorColumnIndex = this._firstColumnIndex;
			this._cursorRowIndex = rowIndex;
		};

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Single select the row.
				this._rowSelectionRange = undefined;
				this._rowSelectionIndexes = new SelectionIndexes(rowIndex);

				// Adjust the cursor and update the waffle.
				await adjustCursor(rowIndex);
				await this.scrollToRow(rowIndex);
				await this.fetchData();

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Clear individually-selected rows.
				this._rowSelectionIndexes = undefined;

				// Set the row selection range.
				this._rowSelectionRange = new SelectionRange(
					Math.min(this._cursorRowIndex, rowIndex),
					Math.max(this._cursorRowIndex, rowIndex)
				);

				// Update the waffle.
				await this.scrollToRow(rowIndex);
				await this.fetchData();

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();
				break;
			}

			// Multi selection.
			case MouseSelectionType.Multi: {
				// If the row index is part of the row selection range, ignore the event to preserve
				// the user's selection.
				if (this._rowSelectionRange?.contains(rowIndex)) {
					return;
				}

				// Multi select the row.
				if (this._rowSelectionIndexes?.has(rowIndex)) {
					// Unselect the row.
					this._rowSelectionIndexes.delete(rowIndex);
					if (this._rowSelectionIndexes.isEmpty()) {
						this._rowSelectionIndexes = undefined;
					}
				} else {
					// Select the row.
					if (this._rowSelectionIndexes) {
						this._rowSelectionIndexes.add(rowIndex);
					} else {
						if (!this._rowSelectionRange) {
							this._rowSelectionIndexes = new SelectionIndexes(rowIndex);
						} else {
							this._rowSelectionIndexes = this._rowSelectionRange.indexes();
							this._rowSelectionIndexes.add(rowIndex);
							this._rowSelectionRange = undefined;
						}
					}

					// Adjust the cursor and update the waffle.
					await adjustCursor(rowIndex);
					await this.scrollToRow(rowIndex);
					await this.fetchData();
				}

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
		if (this._rowSelectionRange || this._rowSelectionIndexes) {
			return;
		}

		// Process extend selection left based on what is currently selected.
		if (this._columnSelectionIndexes) {
			// Convert an individually selected column into a column selection range, if possible.
			if (this._columnSelectionIndexes.has(this._cursorColumnIndex)) {
				if (this._cursorColumnIndex > 0) {
					// Clear the individually-selected columns.
					this._columnSelectionIndexes = undefined;

					// Set the column selection range.
					this._columnSelectionRange = new SelectionRange(
						this._cursorColumnIndex - 1,
						this._cursorColumnIndex
					);

					// Sroll to the column.
					this.scrollToColumn(this._columnSelectionRange.firstIndex);

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._columnSelectionRange) {
			// Expand or contract the column selection range, if possible.
			if (this._cursorColumnIndex === this._columnSelectionRange.lastIndex) {
				if (this._columnSelectionRange.firstIndex > 0) {
					this._columnSelectionRange.firstIndex--;
					this.scrollToColumn(this._columnSelectionRange.firstIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorColumnIndex === this._columnSelectionRange.firstIndex) {
				this._columnSelectionRange.lastIndex--;
				this.scrollToColumn(this._columnSelectionRange.lastIndex);
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
			this._cellSelectionRange = new CellSelectionRange(
				this._cursorColumnIndex - 1,
				this._cursorRowIndex,
				this._cursorColumnIndex,
				this._cursorRowIndex
			);
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
		if (this._rowSelectionRange || this._rowSelectionIndexes) {
			return;
		}

		// Process extend selection right based on what is currently selected.
		if (this._columnSelectionIndexes) {
			// Convert an individually selected column into a column selection range, if possible.
			if (this._columnSelectionIndexes.has(this._cursorColumnIndex)) {
				if (this._cursorColumnIndex < this.columns - 1) {
					// Clear the individually-selected columns.
					this._columnSelectionIndexes = undefined;

					// Set the column selection range.
					this._columnSelectionRange = new SelectionRange(
						this._cursorColumnIndex,
						this._cursorColumnIndex + 1
					);

					// Sroll to the column.
					this.scrollToColumn(this._columnSelectionRange.lastIndex);

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._columnSelectionRange) {
			// Expand or contract the column selection range, if possible.
			if (this._cursorColumnIndex === this._columnSelectionRange.firstIndex) {
				if (this._columnSelectionRange.lastIndex < this.columns - 1) {
					this._columnSelectionRange.lastIndex++;
					this.scrollToColumn(this._columnSelectionRange.lastIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorColumnIndex === this._columnSelectionRange.lastIndex) {
				this._columnSelectionRange.firstIndex++;
				this.scrollToColumn(this._columnSelectionRange.firstIndex);
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
			this._cellSelectionRange = new CellSelectionRange(
				this._cursorColumnIndex,
				this._cursorRowIndex,
				this._cursorColumnIndex + 1,
				this._cursorRowIndex
			);
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
		if (this._columnSelectionRange || this._columnSelectionIndexes) {
			return;
		}

		// Process extend selection up based on what is currently selected.
		if (this._rowSelectionIndexes) {
			// Convert an individually selected row into a row selection range, if possible.
			if (this._rowSelectionIndexes.has(this._cursorRowIndex)) {
				if (this._cursorRowIndex > 0) {
					// Clear the individually-selected rows.
					this._rowSelectionIndexes = undefined;

					// Set the row selection range.
					this._rowSelectionRange = new SelectionRange(
						this._cursorRowIndex - 1,
						this._cursorRowIndex
					);

					// Scroll the row into view.
					this.scrollToRow(this._rowSelectionRange.firstIndex);

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._rowSelectionRange) {
			// Expand or contract the row selection range, if possible.
			if (this._cursorRowIndex === this._rowSelectionRange.lastIndex) {
				if (this._rowSelectionRange.firstIndex > 0) {
					this._rowSelectionRange.firstIndex--;
					this.scrollToRow(this._rowSelectionRange.firstIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorRowIndex === this._rowSelectionRange.firstIndex) {
				this._rowSelectionRange.lastIndex--;
				this.scrollToRow(this._rowSelectionRange.lastIndex);
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
			this._cellSelectionRange = new CellSelectionRange(
				this._cursorColumnIndex,
				this._cursorRowIndex - 1,
				this._cursorColumnIndex,
				this._cursorRowIndex
			);
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
		if (this._columnSelectionRange || this._columnSelectionIndexes) {
			return;
		}

		// Process extend selection down based on what is currently selected.
		if (this._rowSelectionIndexes) {
			// Convert an individually selected row into a row selection range, if possible.
			if (this._rowSelectionIndexes.has(this._cursorRowIndex)) {
				if (this._cursorRowIndex < this.rows - 1) {
					// Clear the individually-selected rows.
					this._rowSelectionIndexes = undefined;

					// Set the row selection range.
					this._rowSelectionRange = new SelectionRange(
						this._cursorRowIndex,
						this._cursorRowIndex + 1
					);

					// Scroll to the row.
					this.scrollToRow(this._rowSelectionRange.lastIndex);

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}
			}
		} else if (this._rowSelectionRange) {
			// Expand or contract the row selection range, if possible.
			if (this._cursorRowIndex === this._rowSelectionRange.firstIndex) {
				if (this._rowSelectionRange.lastIndex < this.rows - 1) {
					this._rowSelectionRange.lastIndex++;
					this.scrollToRow(this._rowSelectionRange.lastIndex);
					this._onDidUpdateEmitter.fire();
				}
			} else if (this._cursorRowIndex === this._rowSelectionRange.lastIndex) {
				this._rowSelectionRange.firstIndex++;
				this.scrollToRow(this._rowSelectionRange.firstIndex);
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
			this._cellSelectionRange = new CellSelectionRange(
				this._cursorColumnIndex,
				this._cursorRowIndex,
				this._cursorColumnIndex,
				this._cursorRowIndex + 1
			);
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

		// If the cell is selected, return the cell selection state. yaya
		if (this._cellSelectionRange?.contains(columnIndex, rowIndex)) {
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
		if (this._columnSelectionIndexes?.has(columnIndex)) {
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
			columnIndex >= this._columnSelectionRange.firstIndex &&
			columnIndex <= this._columnSelectionRange.lastIndex) {
			// The column index is selected.
			let selectionState = ColumnSelectionState.Selected;

			// See if the column index is the first selected column index.
			if (columnIndex === this._columnSelectionRange.firstIndex) {
				selectionState |= ColumnSelectionState.SelectedLeft;
			}

			// See if the column index is the last selected column index.
			if (columnIndex === this._columnSelectionRange.lastIndex) {
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
		if (this._rowSelectionIndexes?.has(rowIndex)) {
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
		if (this._rowSelectionRange?.contains(rowIndex)) {
			// The row index is selected.
			let selectionState = RowSelectionState.Selected;

			// See if the row index is the first selected row index.
			if (rowIndex === this._rowSelectionRange.firstIndex) {
				selectionState |= RowSelectionState.SelectedTop;
			}

			// See if the row index is the last selected row index.
			if (rowIndex === this._rowSelectionRange.lastIndex) {
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
		this._columnSelectionIndexes = undefined;

		// Clear row selection.
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes = undefined;

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Gets the clipboard data.
	 * @returns The clipboard data, if it's available; otherwise, undefined.
	 */
	getClipboardData(): ClipboardData | undefined {
		// Cell selection range.
		if (this._cellSelectionRange) {
			return new ClipboardCellRange(
				this._cellSelectionRange.firstColumnIndex,
				this._cellSelectionRange.firstRowIndex,
				this._cellSelectionRange.lastColumnIndex,
				this._cellSelectionRange.lastRowIndex
			);
		}

		// Column selection range.
		if (this._columnSelectionRange) {
			return new ClipboardColumnRange(
				this._columnSelectionRange.firstIndex,
				this._columnSelectionRange.lastIndex
			);
		}

		// Column selection indexes.
		if (this._columnSelectionIndexes) {
			return new ClipboardColumnIndexes(this._columnSelectionIndexes.sortedArray());
		}

		// Row selection range.
		if (this._rowSelectionRange) {
			return new ClipboardRowRange(
				this._rowSelectionRange.firstIndex,
				this._rowSelectionRange.lastIndex
			);
		}

		// Row selection indexes.
		if (this._rowSelectionIndexes) {
			return new ClipboardRowIndexes(this._rowSelectionIndexes.sortedArray());
		}

		// Cursor cell.
		if (this._cursorColumnIndex >= 0 && this._cursorRowIndex >= 0) {
			return new ClipboardCell(
				this._cursorColumnIndex,
				this._cursorRowIndex
			);
		}

		// Clipboard data isn't available.
		return undefined;
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
	 * Sorts the data.
	 * @param columnSorts The array of column sorts.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
	}

	/**
	 * Fetches data.
	 */
	abstract fetchData(): Promise<void>;

	/**
	 * Gets a column.
	 * @param rowIndex The row index.
	 * @returns The row label.
	 */
	column(columnIndex: number): IDataColumn | undefined {
		return undefined;
	}

	/**
	 * Gets a row header.
	 * @param rowIndex The row index.
	 * @returns The row header, or, undefined.
	 */
	rowHeader(rowIndex: number): JSX.Element | undefined {
		return undefined;
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The data cell, or, undefined.
	 */
	abstract cell(columnIndex: number, rowIndex: number): JSX.Element | undefined;

	/**
	 * Shows the column context menu.
	 * @param columnIndex The column index.
	 * @param anchorElement The anchor element.
	 * @param anchorPoint The anchor point.
	 * @returns A Promise<void> that resolves when the context menu is complete.
	 */
	async showColumnContextMenu(
		columnIndex: number,
		anchorElement: HTMLElement,
		anchorPoint?: AnchorPoint
	): Promise<void> {
		// Do nothing. This method can be overridden in subclasses.
	}

	/**
	 * Shows the row context menu.
	 * @param rowIndex The row index.
	 * @param anchorElement The anchor element.
	 * @param anchorPoint The anchor point.
	 * @returns A Promise<void> that resolves when the context menu is complete.
	 */
	async showRowContextMenu(
		rowIndex: number,
		anchorElement: HTMLElement,
		anchorPoint?: AnchorPoint
	): Promise<void> {
		// Do nothing. This method can be overridden in subclasses.
	}

	/**
	 * Shows the cell context menu.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @param anchorElement The anchor element.
	 * @param anchorPoint The anchor point.
	 * @returns A Promise<void> that resolves when the context menu is complete.
	 */
	async showCellContextMenu(
		columnIndex: number,
		rowIndex: number,
		anchorElement: HTMLElement,
		anchorPoint?: AnchorPoint
	): Promise<void> {
		// Do nothing. This method can be overridden in subclasses.
	}

	//#endregion Public Methods

	//#region Protected Methods

	/**
	 * Performs a reset of the data grid.
	 */
	protected softReset() {
		// Reset the display.
		this._firstColumnIndex = 0;
		this._firstRowIndex = 0;
		if (this._cursorInitiallyHidden) {
			this._cursorColumnIndex = -1;
			this._cursorRowIndex = -1;
		} else {
			this._cursorColumnIndex = 0;
			this._cursorRowIndex = 0;
		}

		// Reset selection.
		this.resetSelection();
	}

	/**
	 * Resets the selection.
	 */
	protected resetSelection() {
		this._cellSelectionRange = undefined;
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes = undefined;
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes = undefined;
	}

	//#endregion Protected Methods

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
