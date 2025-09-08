/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { JSX } from 'react';

// Other dependencies.
import { IDataColumn } from '../interfaces/dataColumn.js';
import { Emitter } from '../../../../base/common/event.js';
import { IColumnSortKey } from '../interfaces/columnSortKey.js';
import { ILayoutEntry, LayoutManager } from './layoutManager.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { AnchorPoint } from '../../positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';

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
	readonly maximumColumnWidth?: never;
} | {
	readonly columnResize: true;
	readonly minimumColumnWidth: number;
	readonly maximumColumnWidth: number;
};

/**
 * RowResizeOptions type.
 */
type RowResizeOptions = | {
	readonly rowResize: false;
	readonly minimumRowHeight?: never;
	readonly maximumRowHeight?: never;
} | {
	readonly rowResize: true;
	readonly minimumRowHeight: number;
	readonly maximumRowHeight: number;
};

/**
 * ColumnPinningOptions type.
 */
type ColumnPinningOptions = | {
	readonly columnPinning: false;
	readonly maximumPinnedColumns?: never;
} | {
	readonly columnPinning: true;
	readonly maximumPinnedColumns: number;
}

/**
 * RowPinningOptions type.
 */
type RowPinningOptions = | {
	readonly rowPinning: false;
	readonly maximumPinnedRows?: never;
} | {
	readonly rowPinning: true;
	readonly maximumPinnedRows: number;
}

/**
 * ScrollbarOptions type.
 */
type ScrollbarOptions = | {
	readonly horizontalScrollbar: false;
	readonly verticalScrollbar: false;
	readonly scrollbarThickness?: never;
	readonly scrollbarOverscroll?: never;
} | {
	readonly horizontalScrollbar: true;
	readonly verticalScrollbar: false;
	readonly scrollbarThickness: number;
	readonly scrollbarOverscroll: number;
} | {
	readonly horizontalScrollbar: false;
	readonly verticalScrollbar: true;
	readonly scrollbarThickness: number;
	readonly scrollbarOverscroll: number;
} | {
	readonly horizontalScrollbar: true;
	readonly verticalScrollbar: true;
	readonly scrollbarThickness: number;
	readonly scrollbarOverscroll: number;
};

/**
 * DisplayOptions type.
 */
type DisplayOptions = | {
	useEditorFont: boolean;
	automaticLayout: boolean;
	rowsMargin?: number;
	cellBorders?: boolean;
	horizontalCellPadding?: number;
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
	ColumnPinningOptions &
	RowPinningOptions &
	ScrollbarOptions &
	DisplayOptions &
	CursorOptions &
	DefaultCursorOptions &
	SelectionOptions;

/**
 * ColumnDescriptor interface.
 */
export interface ColumnDescriptor {
	readonly columnIndex: number;
	readonly left: number;
	readonly width: number;
}

/**
 * ColumnDescriptors interface.
 */
export interface ColumnDescriptors {
	pinnedColumnDescriptors: ColumnDescriptor[];
	unpinnedColumnDescriptors: ColumnDescriptor[];
}

/**
 * RowDescriptor interface.
 */
export interface RowDescriptor {
	readonly rowIndex: number;
	readonly top: number;
	readonly height: number;
}

/**
 * RowDescriptors interface.
 */
export interface RowDescriptors {
	pinnedRowDescriptors: RowDescriptor[];
	unpinnedRowDescriptors: RowDescriptor[];
}

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
	SelectedRight = 4,
}

/**
 * RowSelectionState enumeration.
 */
export enum RowSelectionState {
	None = 0,
	Selected = 1,
	SelectedTop = 8,
	SelectedBottom = 16,
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
 * CellSelectionIndexes class.
 */
class CellSelectionIndexes {
	/**
	 * Gets the column indexes set.
	 */
	private readonly _columnIndexesSet: Set<number>;

	/**
	 * Gets the row indexes set.
	 */
	private readonly _rowIndexesSet: Set<number>;

	/**
	 * Gets the first column index.
	 */
	get firstColumnIndex() {
		return this.columnIndexes[0];
	}

	/**
	 * Gets the last column index.
	 */
	get lastColumnIndex() {
		return this.columnIndexes[this.columnIndexes.length - 1];
	}

	/**
	 * Gets the first row index.
	 */
	get firstRowIndex() {
		return this.rowIndexes[0];
	}

	/**
	 * Gets the last row index.
	 */
	get lastRowIndex() {
		return this.rowIndexes[this.rowIndexes.length - 1];
	}

	/**
	 * Constructor.
	 * @param columnIndexes The column indices.
	 * @param rowIndexes The row indices.
	 */
	constructor(public readonly columnIndexes: number[], public readonly rowIndexes: number[]) {
		this._columnIndexesSet = new Set(columnIndexes);
		this._rowIndexesSet = new Set(rowIndexes);
	}

	/**
	 * Returns a value which indicates whether the specified column index and row index is contained
	 * in the cell selection.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns true if the column index and row index is contained in the cell selection range; otherwise, false.
	 */
	contains(columnIndex: number, rowIndex: number) {
		return this._columnIndexesSet.has(columnIndex) && this._rowIndexesSet.has(rowIndex);
	}
}

/**
 * SelectionIndexes class.
 */
class SelectionIndexes {
	/**
	 * Gets the indexes set.
	 */
	private readonly _indexesSet = new Set<number>();

	/**
	 * Gets the first column index.
	 */
	get firstIndex() {
		return this.indexes[0];
	}

	/**
	 * Gets the last index.
	 */
	get lastIndex() {
		return this.indexes[this.indexes.length - 1];
	}

	/**
	 * Constructor.
	 * @param indexes The indexes.
	 */
	constructor(public readonly indexes: number[]) {
		this._indexesSet = new Set(indexes);
	}

	/**
	 * Determines whether the selection indexes contains the specified index.
	 * @param index The index.
	 * @returns true, if the selection indexes contains the specified index; otherwise, false.
	 */
	contains(index: number) {
		return this._indexesSet.has(index);
	}
}

/**
 * ClipboardCell class.
 */
export class ClipboardCell {
	/**
	 * Constructor.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 */
	constructor(readonly columnIndex: number, readonly rowIndex: number) {
	}
}

/**
 * ClipboardCellIndexes class.
 */
export class ClipboardCellIndexes {
	/**
	 * Constructor.
	 * @param columnIndexes The column indexes.
	 * @param rowIndexes The row indexes.
	 */
	constructor(readonly columnIndexes: number[], readonly rowIndexes: number[]) {
	}
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
	ClipboardCellIndexes |
	ClipboardColumnIndexes |
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
	 * Gets or sets the sort order; true for ascending, false for descending.
	 */
	private _ascending: boolean;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constuctor.
	 * @param sortIndex The sort index.
	 * @param columnIndex The column index.
	 * @param ascending The sort order; true for ascending, false for descending.
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
 * Represents a position and its corresponding index.
 */
interface PositionIndex {
	readonly position: number;
	readonly index: number;
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
	 * Gets a value which indicates whether column resize is enabled.
	 */
	private readonly _columnResize: boolean;

	/**
	 * Gets the minimum column width.
	 */
	private readonly _minimumColumnWidth: number;

	/**
	 * Gets the maximum column width.
	 */
	private readonly _maximumColumnWidth: number;

	/**
	 * Gets the default column width.
	 */
	private readonly _defaultColumnWidth: number;

	/**
	 * Gets a value which indicates whether row resize is enabled.
	 */
	private readonly _rowResize: boolean;

	/**
	 * Gets the minimum row height.
	 */
	private readonly _minimumRowHeight: number;

	/**
	 * Gets the maximum row height.
	 */
	private readonly _maximumRowHeight: number;

	/**
	 * Gets the default row height.
	 */
	private readonly _defaultRowHeight: number;

	/**
	 * Gets a value which indicates whether column pinning is enabled.
	 */
	private readonly _columnPinning: boolean;

	/**
	 * Gets the maximum number of pinned columns.
	 */
	private readonly _maximumPinnedColumns: number;

	/**
	 * Gets a value which indicates whether row pinning is enabled.
	 */
	private readonly _rowPinning: boolean;

	/**
	 * Gets the maximum number of pinned rows.
	 */
	private readonly _maximumPinnedRows: number;

	/**
	 * Gets a value which indicates whether to show the horizontal scrollbar.
	 */
	private readonly _horizontalScrollbar: boolean;

	/**
	 * Gets a value which indicates whether to show the vertical scrollbar.
	 */
	private readonly _verticalScrollbar: boolean;

	/**
	 * Gets the scrollbar thickness.
	 */
	private readonly _scrollbarThickness: number;

	/**
	 * Gets the scrollbar overscroll.
	 */
	private readonly _scrollbarOverscroll: number;

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
	 * Gets the horizontal cell padding.
	 */
	private readonly _horizontalCellPadding: number;

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
	 * Gets or sets the cursor column index.
	 */
	private _cursorColumnIndex = 0;

	/**
	 * Gets or sets the cursor row index.
	 */
	private _cursorRowIndex = 0;

	/**
	 * Gets or sets the cell selection indexes.
	 */
	private _cellSelectionIndexes?: CellSelectionIndexes;

	/**
	 * Gets the column selection indexes.
	 */
	private _columnSelectionIndexes?: SelectionIndexes;

	/**
	 * Gets the row selection indexes.
	 */
	private _rowSelectionIndexes?: SelectionIndexes;

	/**
	 * A value which indicates that there is a pending onDidUpdate event.
	 */
	private _pendingOnDidUpdateEvent = false;

	//#endregion Private Properties

	//#region Private Events

	/**
	 * The onDidUpdate event emitter.
	 */
	private readonly _onDidUpdateEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidChangeColumnSorting event emitter.
	 */
	private readonly _onDidChangeColumnSortingEmitter = this._register(new Emitter<boolean>);

	//#endregion Private Events

	//#region Protected Properties

	/**
	 * The horizontal scroll offset.
	 */
	protected _horizontalScrollOffset = 0;

	/**
	 * The vertical scroll offset.
	 */
	protected _verticalScrollOffset = 0;

	/**
	 * Gets the column layout manager.
	 */
	protected readonly _columnLayoutManager: LayoutManager;

	/**
	 * Gets the row layout manager.
	 */
	protected readonly _rowLayoutManager: LayoutManager;

	/**
	 * Gets the column sort keys. Keyed by column index.
	 */
	protected readonly _columnSortKeys = new Map<number, ColumnSortKeyDescriptor>();

	//#endregion Protected Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param options The options.
	 */
	constructor(options: DataGridOptions) {
		// Call the base class's constructor.
		super();

		// ColumnHeaderOptions.
		this._columnHeaders = options.columnHeaders || false;
		this._columnHeadersHeight = this._columnHeaders ? options.columnHeadersHeight ?? 0 : 0;

		// RowHeaderOptions.
		this._rowHeaders = options.rowHeaders || false;
		this._rowHeadersWidth = this._rowHeaders ? options.rowHeadersWidth ?? 0 : 0;
		this._rowHeadersResize = this._rowHeaders ? options.rowHeadersResize ?? false : false;

		// DefaultSizeOptions.
		this._defaultColumnWidth = options.defaultColumnWidth;
		this._defaultRowHeight = options.defaultRowHeight;

		// ColumnResizeOptions.
		this._columnResize = options.columnResize || false;
		this._minimumColumnWidth = options.minimumColumnWidth ?? this._defaultColumnWidth;
		this._maximumColumnWidth = options.maximumColumnWidth ?? this._defaultColumnWidth;

		// RowResizeOptions.
		this._rowResize = options.rowResize || false;
		this._minimumRowHeight = options.minimumRowHeight ?? options.defaultRowHeight;
		this._maximumRowHeight = options.maximumRowHeight ?? options.defaultRowHeight;

		// ColumnPinningOptions.
		this._columnPinning = options.columnPinning || false;
		this._maximumPinnedColumns = this._columnPinning ? options.maximumPinnedColumns ?? 0 : 0;

		// RowPinningOptions.
		this._rowPinning = options.rowPinning || false;
		this._maximumPinnedRows = this._rowPinning ? options.maximumPinnedRows ?? 0 : 0;

		// ScrollbarOptions.
		this._horizontalScrollbar = options.horizontalScrollbar || false;
		this._verticalScrollbar = options.verticalScrollbar || false;
		this._scrollbarThickness = options.scrollbarThickness ?? 0;
		this._scrollbarOverscroll = options.scrollbarOverscroll ?? 0;

		// DisplayOptions.
		this._useEditorFont = options.useEditorFont;
		this._automaticLayout = options.automaticLayout;
		this._rowsMargin = options.rowsMargin ?? 0;
		this._cellBorders = options.cellBorders ?? true;
		this._horizontalCellPadding = options.horizontalCellPadding ?? 0;

		// CursorOptions.
		this._cursorInitiallyHidden = options.cursorInitiallyHidden ?? false;
		if (options.cursorInitiallyHidden) {
			this._cursorColumnIndex = -1;
			this._cursorRowIndex = -1;
		}

		// DefaultCursorOptions.
		this._internalCursor = options.internalCursor ?? true;
		this._cursorOffset = this._internalCursor ? options.cursorOffset ?? 0 : 0;

		// SelectionOptions.
		this._selection = options.selection ?? true;

		// Allocate and initialize the layout managers.
		this._columnLayoutManager = new LayoutManager(this._defaultColumnWidth);
		this._rowLayoutManager = new LayoutManager(this._defaultRowHeight);
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
	 * Gets a value which indicates whether column resize is enabled.
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
	 * Gets the maximum column width.
	 */
	get maximumColumnWidth() {
		return this._maximumColumnWidth;
	}

	/**
	 * Gets the default column width.
	 */
	get defaultColumnWidth() {
		return this._defaultColumnWidth;
	}

	/**
	 * Gets a value which indicates whether row resize is enabled
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
	 * Gets the maximum row height.
	 */
	get maximumRowHeight() {
		return this._maximumRowHeight;
	}

	/**
	 * Gets the default row height.
	 */
	get defaultRowHeight() {
		return this._defaultRowHeight;
	}

	/**
	 * Gets a value which indicates whether column pinning is enabled
	 */
	get columnPinning() {
		return this._columnPinning;
	}

	/**
	 * Gets the maximum number of pinned columns.
	 */
	get maximumPinnedColumns() {
		return this._maximumPinnedColumns;
	}

	/**
	 * Gets a value which indicates whether row pinning is enabled
	 */
	get rowPinning() {
		return this._rowPinning;
	}

	/**
	 * Gets the maximum number of pinned rows.
	 */
	get maximumPinnedRows() {
		return this._maximumPinnedRows;
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
	get scrollbarThickness() {
		return this._scrollbarThickness;
	}

	/**
	 * Gets the scrollbar overscroll.
	 */
	get scrollbarOverscroll() {
		return this._scrollbarOverscroll;
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
	get cellBorders() {
		return this._cellBorders;
	}

	/**
	 * Gets the horizontal cell padding.
	 */
	get horizontalCellPadding() {
		return this._horizontalCellPadding;
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

	/**
	 * Gets the hover manager for displaying tooltips, if available.
	 * @returns The hover manager, or undefined if not available.
	 */
	get hoverManager(): PositronActionBarHoverManager | undefined {
		return undefined;
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
	 * Gets the scroll width.
	 */
	get scrollWidth() {
		return this._columnLayoutManager.unpinnedLayoutEntriesSize + this._scrollbarOverscroll;
	}

	/**
	 * Gets the scroll height.
	 */
	get scrollHeight() {
		return (this._rowsMargin * 2) + this._rowLayoutManager.unpinnedLayoutEntriesSize + this._scrollbarOverscroll;
	}

	/**
	 * Gets the page width.
	 */
	get pageWidth() {
		return this.layoutWidth;
	}

	/**
	 * Gets the page height.
	 */
	get pageHeight() {
		return this.layoutHeight;
	}

	/**
	 * Gets the layout width.
	 */
	get layoutWidth() {
		// Set the layout width.
		let layoutWidth = this._width;

		// If row headers are enabled, subtract the row headers width.
		if (this.rowHeaders) {
			layoutWidth -= this._rowHeadersWidth;
		}

		// If column pinning is enabled, subtract the pinned columns width.
		if (this.columnPinning) {
			layoutWidth -= this._columnLayoutManager.pinnedLayoutEntriesSize;
		}

		// If the vertical scrollbar is enabled, subtract the scrollbar width.
		if (this._verticalScrollbar) {
			layoutWidth -= this._scrollbarThickness;
		}

		// Return the layout width.
		return layoutWidth;
	}

	/**
	 * Gets the layout right.
	 */
	get layoutRight() {
		return this.horizontalScrollOffset + this.layoutWidth;
	}

	/**
	 * Gets the layout height.
	 */
	get layoutHeight() {
		// Set the layout height.
		let layoutHeight = this._height;

		// If column headers are enabled, subtract the column headers height.
		if (this.columnHeaders) {
			layoutHeight -= this._columnHeadersHeight;
		}

		// If row pinning is enabled, subtract the pinned rows height.
		if (this.rowPinning) {
			layoutHeight -= this._rowLayoutManager.pinnedLayoutEntriesSize;
		}

		// If the horizontal scrollbar is enabled, subtract the scrollbar height.
		if (this._horizontalScrollbar) {
			layoutHeight -= this._scrollbarThickness;
		}

		// Return the layout height.
		return layoutHeight;
	}

	/**
	 * Gets the layout bottom.
	 */
	get layoutBottom() {
		return this.verticalScrollOffset + this.layoutHeight;
	}

	/**
	 * Gets the screen columns.
	 */
	get screenColumns() {
		return Math.ceil(this._width / this._minimumColumnWidth);
	}

	/**
	 * Gets the screen rows.
	 */
	get screenRows() {
		return Math.ceil(this._height / this._minimumRowHeight);
	}

	/**
	 * Gets the maximum horizontal scroll offset.
	 */
	get maximumHorizontalScrollOffset() {
		// If the scroll width is less than or equal to the layout width, return 0; otherwise,
		// calculate and return the maximum horizontal scroll offset.
		return this.scrollWidth <= this.layoutWidth ? 0 : this.scrollWidth - this.layoutWidth;
	}

	/**
	 * Gets the maximum vertical scroll offset.
	 */
	get maximumVerticalScrollOffset() {
		// If the scroll height is less than or equal to the layout height, return 0; otherwise,
		// calculate and return the maximum vertical scroll offset.
		return this.scrollHeight <= this.layoutHeight ? 0 : this.scrollHeight - this.layoutHeight;
	}

	/**
	 * Gets the first column.
	 */
	get firstColumn(): ColumnDescriptor | undefined {
		// Get the first column layout entry. If it wasn't found, return undefined.
		const layoutEntry = this._columnLayoutManager.findFirstUnpinnedLayoutEntry(this.horizontalScrollOffset);
		if (!layoutEntry) {
			return undefined;
		}

		// Return the column descriptor for the first column.
		return {
			columnIndex: layoutEntry.index,
			left: layoutEntry.start,
			width: layoutEntry.size,
		};
	}

	/**
	 * Gets the first row.
	 */
	get firstRow(): RowDescriptor | undefined {
		// Get the first row layout entry. If it wasn't found, return undefined.
		const layoutEntry = this._rowLayoutManager.findFirstUnpinnedLayoutEntry(this.verticalScrollOffset);
		if (!layoutEntry) {
			return undefined;
		}

		// Return the row descriptor for the first row.
		return {
			rowIndex: layoutEntry.index,
			top: layoutEntry.start,
			height: layoutEntry.size,
		};
	}

	/**
	 * Gets the horizontal scroll offset.
	 */
	get horizontalScrollOffset() {
		return this._horizontalScrollOffset;
	}

	/**
	 * Gets the vertical scroll offset.
	 */
	get verticalScrollOffset() {
		return this._verticalScrollOffset;
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

	/**
	 * Gets a value which indicates whether column sorting is active.
	 */
	get isColumnSorting() {
		return this._columnSortKeys.size > 0;
	}

	//#endregion Public Properties

	//#region Public Events

	/**
	 * onDidUpdate event.
	 */
	readonly onDidUpdate = this._onDidUpdateEmitter.event;

	/**
	 * onDidChangeColumnSorting event.
	 */
	readonly onDidChangeColumnSorting = this._onDidChangeColumnSortingEmitter.event;

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
			this.fireOnDidUpdateEvent();
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
	 * Gets column descriptors.
	 * @param horizontalOffset The horizontal offset of the unpinned column descriptors to return.
	 * @param width The width of the unpinned column descriptors to return.
	 * @returns The column descriptors.
	 */
	getColumnDescriptors(horizontalOffset: number, width: number): ColumnDescriptors {
		// Get the pinned column descriptors.
		const pinnedLayoutEntries = this._columnLayoutManager.pinnedLayoutEntries(width);
		const pinnedColumnDescriptors = pinnedLayoutEntries.map((pinnedLayoutEntry): ColumnDescriptor => ({
			columnIndex: pinnedLayoutEntry.index,
			left: pinnedLayoutEntry.start,
			width: pinnedLayoutEntry.size,
		}));

		// Calculate the total width of the pinned column descriptors.
		const pinnedColumnDescriptorsWidth = (() => {
			if (!pinnedColumnDescriptors.length) {
				return 0;
			} else {
				const lastPinnedColumnDescriptor = pinnedColumnDescriptors[pinnedColumnDescriptors.length - 1];
				return lastPinnedColumnDescriptor.left + lastPinnedColumnDescriptor.width;
			}
		})();

		// Get the unpinned column descriptors.
		const unpinnedLayoutEntries = this._columnLayoutManager.unpinnedLayoutEntries(horizontalOffset, width - pinnedColumnDescriptorsWidth);
		const unpinnedColumnDescriptors = unpinnedLayoutEntries.map((pinnedLayoutEntry): ColumnDescriptor => ({
			columnIndex: pinnedLayoutEntry.index,
			left: pinnedColumnDescriptorsWidth + pinnedLayoutEntry.start,
			width: pinnedLayoutEntry.size,
		}));

		// Return the column descriptors.
		return {
			pinnedColumnDescriptors,
			unpinnedColumnDescriptors,
		};
	}

	/**
	 * Gets row descriptors.
	 * @param verticalOffset The vertical offset of the unpinned row descriptors to return.
	 * @param layoutHeight The height of the unpinned row descriptors to return.
	 * @returns The row descriptors.
	 */
	getRowDescriptors(verticalOffset: number, layoutHeight: number): RowDescriptors {
		// Get the pinned row descriptors.
		const pinnedLayoutEntries = this._rowLayoutManager.pinnedLayoutEntries(layoutHeight);
		const pinnedRowDescriptors = pinnedLayoutEntries.map((pinnedLayoutEntry): RowDescriptor => ({
			rowIndex: pinnedLayoutEntry.index,
			top: pinnedLayoutEntry.start,
			height: pinnedLayoutEntry.size,
		}))

		// Calculate the total height of the pinned row descriptors.
		const pinnedRowDescriptorsHeight = (() => {
			if (!pinnedRowDescriptors.length) {
				return 0;
			} else {
				const lastPinnedRowDescriptor = pinnedRowDescriptors[pinnedRowDescriptors.length - 1];
				return lastPinnedRowDescriptor.top + lastPinnedRowDescriptor.height;
			}
		})();

		// Get the unpinned row descriptors.
		const unpinnedLayoutEntries = this._rowLayoutManager.unpinnedLayoutEntries(verticalOffset, layoutHeight - pinnedRowDescriptorsHeight);
		const unpinnedRowDescriptors = unpinnedLayoutEntries.map((pinnedLayoutEntry): RowDescriptor => ({
			rowIndex: pinnedLayoutEntry.index,
			top: pinnedRowDescriptorsHeight + pinnedLayoutEntry.start,
			height: pinnedLayoutEntry.size,
		}));

		// Return the row descriptors.
		return {
			pinnedRowDescriptors,
			unpinnedRowDescriptors,
		};
	}

	/**
	 * Gets the custom width of a column. This can be overridden by subclasses to provide
	 * custom column widths (e.g., for fixed-width columns).
	 * @param columnIndex The column index.
	 * @returns The custom width of the column; otherwise, undefined.
	 */
	getCustomColumnWidth(columnIndex: number): number | undefined {
		return undefined;
	}

	/**
	 * Sets a column width.
	 * @param columnIndex The column index.
	 * @param columnWidth The column width.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setColumnWidth(columnIndex: number, columnWidth: number): Promise<void> {
		// If column resize is disabled, return.
		if (!this._columnResize) {
			return;
		}

		// Set the column width override.
		this._columnLayoutManager.setSizeOverride(columnIndex, columnWidth);

		// Fetch data.
		await this.fetchData();

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Sets a row height.
	 * @param rowIndex The row index.
	 * @param rowHeight The row height.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setRowHeight(rowIndex: number, rowHeight: number): Promise<void> {
		// If row resize is disabled, return.
		if (!this._rowResize) {
			return;
		}

		// Set the row height override.
		this._rowLayoutManager.setSizeOverride(rowIndex, rowHeight);

		// Fetch data.
		await this.fetchData();

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Scrolls the page up.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async scrollPageUp() {
		// Get the first unpinned layout entry.
		const firstUnpinnedLayoutEntry = this._rowLayoutManager.findFirstUnpinnedLayoutEntry(this.verticalScrollOffset);
		if (firstUnpinnedLayoutEntry === undefined) {
			return;
		}

		// Get the first unpinned layout entry position.
		const firstUnpinnedLayoutEntryPosition = this._rowLayoutManager.mapIndexToPosition(firstUnpinnedLayoutEntry.index);
		if (firstUnpinnedLayoutEntryPosition === undefined) {
			return;
		}

		// Find the layout entry that will be the first layout entry for the previous page.
		let lastFullyVisibleLayoutEntry: ILayoutEntry | undefined = undefined;
		for (let position = firstUnpinnedLayoutEntryPosition - 1; position >= 0; position--) {
			// Get the index of the position.
			const index = this._rowLayoutManager.mapPositionToIndex(position);
			if (index === undefined) {
				return;
			}

			// Get the layout entry.
			const layoutEntry = this._rowLayoutManager.getLayoutEntry(index);
			if (layoutEntry === undefined) {
				return;
			}

			// Check if the layout entry is fully visible, note it; otherwise, scroll the viewport and return.
			if (layoutEntry.start >= this.verticalScrollOffset - this.layoutHeight) {
				lastFullyVisibleLayoutEntry = layoutEntry;
			} else {
				// Set the vertical scroll offset.
				this.setVerticalScrollOffset(lastFullyVisibleLayoutEntry?.start ?? layoutEntry.start);

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();

				// Done.
				return;
			}
		}

		// If we drop through to here, scroll to the top.
		this.setVerticalScrollOffset(0);

		// Fetch data.
		await this.fetchData();

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Scrolls the page down.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async scrollPageDown() {
		// Get the first unpinned layout entry.
		const firstUnpinnedLayoutEntry = this._rowLayoutManager.findFirstUnpinnedLayoutEntry(this.verticalScrollOffset);
		if (firstUnpinnedLayoutEntry === undefined) {
			return;
		}

		// Get the first unpinned layout entry position.
		const firstUnpinnedLayoutEntryPosition = this._rowLayoutManager.mapIndexToPosition(firstUnpinnedLayoutEntry.index);
		if (firstUnpinnedLayoutEntryPosition === undefined) {
			return;
		}

		// Scroll down to the next unpinned layout entry.
		for (let position = firstUnpinnedLayoutEntryPosition + 1; position < this._rowLayoutManager.entryCount; position++) {
			// Get the index of the position.
			const index = this._rowLayoutManager.mapPositionToIndex(position);
			if (index === undefined) {
				return;
			}

			// Get the layout entry.
			const layoutEntry = this._rowLayoutManager.getLayoutEntry(index);
			if (layoutEntry === undefined) {
				return;
			}

			// If the layout entry ends at or beyond the viewport, scroll to it.
			if (layoutEntry.end >= this.verticalScrollOffset + this.layoutHeight) {
				// Set the vertical scroll offset.
				this.setVerticalScrollOffset(Math.min(layoutEntry.start, this.maximumVerticalScrollOffset));

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();

				// Done.
				return;
			}
		}

		// If we drop through to here, scroll to the bottom.
		this.setVerticalScrollOffset(this.maximumVerticalScrollOffset);

		// Fetch data.
		await this.fetchData();

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
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
		} else if (ascending !== columnSortKey.ascending) {
			// Update the column sort key.
			columnSortKey.ascending = ascending;
		} else {
			// Sorting has not unchanged. Do nothing.
			return;
		}

		// Clear selection.
		this.clearSelection();

		// Fire the onDidChangeColumnSorting event.
		this._onDidChangeColumnSortingEmitter.fire(true);

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();

		// Sort the data.
		await this.doSortData();
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

			// Clear selection.
			this.clearSelection();

			// Fire the onDidChangeColumnSorting event.
			this._onDidChangeColumnSortingEmitter.fire(this._columnSortKeys.size > 0);

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();

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

		// Clear selection.
		this.clearSelection();

		// Fire the onDidChangeColumnSorting event.
		this._onDidChangeColumnSortingEmitter.fire(false);

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();

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
			// Set the row headers width.
			this._rowHeadersWidth = rowHeadersWidth;

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Sets the size.
	 * @param width The width.
	 * @param height The height.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setSize(width: number, height: number): Promise<void> {
		// If the size changed, optmize the vertical scroll offset, fetch data and fire the
		// onDidUpdate event.
		if (width !== this._width || height !== this._height) {
			// Update the width and height.
			this._width = width;
			this._height = height;

			// Optimimize the vertical scroll offset.
			if (this._verticalScrollOffset > this.maximumVerticalScrollOffset) {
				this._verticalScrollOffset = this.maximumVerticalScrollOffset;
			}

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Sets the scroll offsets.
	 * @param horizontalScrollOffset The horizontal scroll offset.
	 * @param verticalScrollOffset The vertical scroll offset.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setScrollOffsets(
		horizontalScrollOffset: number,
		verticalScrollOffset: number
	): Promise<void> {
		// If the screen position has changed, update the data grid.
		if (horizontalScrollOffset !== this._horizontalScrollOffset ||
			verticalScrollOffset !== this._verticalScrollOffset
		) {
			// Set the screen position.
			this._horizontalScrollOffset = horizontalScrollOffset;
			this._verticalScrollOffset = verticalScrollOffset;

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Sets the horizontal scroll offset.
	 * @param horizontalScrollOffset The horizontal scroll offset.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setHorizontalScrollOffset(horizontalScrollOffset: number): Promise<void> {
		if (horizontalScrollOffset !== this._horizontalScrollOffset) {
			// Set the horizontal scroll offset.
			this._horizontalScrollOffset = horizontalScrollOffset;

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Sets the vertical scroll offset.
	 * @param verticalScrollOffset The vertical scroll offset.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async setVerticalScrollOffset(verticalScrollOffset: number): Promise<void> {
		if (verticalScrollOffset !== this._verticalScrollOffset) {
			// Set the vertical scroll offset.
			this._verticalScrollOffset = verticalScrollOffset;

			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Sets the cursor position.
	 * @param cursorColumnIndex The cursor column index.
	 * @param cursorRowIndex The cursor row index.
	 */
	setCursorPosition(cursorColumnIndex: number, cursorRowIndex: number) {
		if (cursorColumnIndex !== this._cursorColumnIndex || cursorRowIndex !== this._cursorRowIndex) {
			// Set the cursor position.
			this._cursorColumnIndex = cursorColumnIndex;
			this._cursorRowIndex = cursorRowIndex;

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
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
			this.fireOnDidUpdateEvent();
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
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Gets the first column index.
	 */
	get firstColumnIndex() {
		return this._columnLayoutManager.firstIndex;
	}

	/**
	 * Gets the last column index.
	 */
	get lastColummIndex() {
		return this._columnLayoutManager.lastIndex;
	}

	/**
	 * Gets the first row index.
	 */
	get firstRowIndex() {
		return this._rowLayoutManager.firstIndex;
	}

	/**
	 * Gets the last row index.
	 */
	get lastRowIndex() {
		return this._rowLayoutManager.lastIndex;
	}

	/**
	 * Returns a value which indicates whether the specified column is pinned.
	 * @param columnIndex The column index.
	 * @returns true if the specified column is pinned; otherwise, false.
	 */
	isColumnPinned(columnIndex: number) {
		return this._columnLayoutManager.isPinnedIndex(columnIndex);
	}

	/**
	 * Pins a column.
	 * @param columnIndex The index of the column to pin.
	 */
	pinColumn(columnIndex: number) {
		// If column pinning is enabled, and the maximum pinned columns limit has not been reached, pin the column.
		if (this._columnPinning && this._columnLayoutManager.pinnedIndexesCount < this._maximumPinnedColumns && this._columnLayoutManager.pinIndex(columnIndex)) {
			this.clearSelection();
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Unpins a column.
	 * @param columnIndex The index of the column to unpin.
	 */
	unpinColumn(columnIndex: number) {
		// If column pinning is enabled, unpin the column.
		if (this._columnPinning && this._columnLayoutManager.unpinIndex(columnIndex)) {
			this.clearSelection();
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Returns a value which indicates whether the specified row is pinned.
	 * @param rowIndex The row index.
	 * @returns true if the specified row is pinned; otherwise, false.
	 */
	isRowPinned(rowIndex: number) {
		return this._rowLayoutManager.isPinnedIndex(rowIndex);
	}

	/**
	 * Pins a row.
	 * @param rowIndex The index of the row to pin.
	 */
	pinRow(rowIndex: number) {
		// If row pinning is enabled, and the maximum pinned rows limit has not been reached, pin the row.
		if (this._rowPinning && this._rowLayoutManager.pinnedIndexesCount < this._maximumPinnedRows && this._rowLayoutManager.pinIndex(rowIndex)) {
			this.clearSelection();
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Unpins a row.
	 * @param rowIndex The index of the row to unpin.
	 */
	unpinRow(rowIndex: number) {
		// If row pinning is enabled, unpin the row.
		if (this._rowPinning && this._rowLayoutManager.unpinIndex(rowIndex)) {
			this.clearSelection();
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Moves the cursor up.
	 */
	moveCursorUp() {
		// Get the previous row index using the row layout manager.
		const previousRowIndex = this._rowLayoutManager.previousIndex(this._cursorRowIndex)

		// If the previous row index is undefined, this means that the cursor is already at the top row.
		if (previousRowIndex === undefined) {
			return;
		}

		// Set the cursor row index to the previous row index and fire the onDidUpdate event.
		this._cursorRowIndex = previousRowIndex;

		this.scrollToCursor()

		this.fireOnDidUpdateEvent();
	}

	/**
	 * Moves the cursor down.
	 */
	moveCursorDown() {
		// Get the next row index using the row layout manager.
		const nextRowIndex = this._rowLayoutManager.nextIndex(this._cursorRowIndex)

		// If the next row index is undefined, this means that the cursor is already at the bottom row.
		if (nextRowIndex === undefined) {
			return;
		}

		// Set the cursor row index to the next row index and fire the onDidUpdate event.
		this._cursorRowIndex = nextRowIndex;

		// Scroll to the cursor.
		this.scrollToCursor()

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Moves the cursor left.
	 */
	moveCursorLeft() {
		// Get the previous column index using the column layout manager.
		const previousColumnIndex = this._columnLayoutManager.previousIndex(this._cursorColumnIndex)

		// If the previous column index is undefined, this means that the cursor is already at the first column.
		if (previousColumnIndex === undefined) {
			return;
		}

		// Set the cursor column index to the previous column index.
		this._cursorColumnIndex = previousColumnIndex;

		// Scroll to the cursor column index.
		this.scrollToColumn(this._cursorColumnIndex);

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Moves the cursor right.
	 */
	moveCursorRight() {
		// Get the next column index using the column layout manager.
		const nextColumnIndex = this._columnLayoutManager.nextIndex(this._cursorColumnIndex)

		// If the next column index is undefined, this means that the cursor is already at the last column.
		if (nextColumnIndex === undefined) {
			return;
		}

		// Set the cursor column index to the next column index.
		this._cursorColumnIndex = nextColumnIndex;

		// Scroll to the cursor column index.
		this.scrollToColumn(this._cursorColumnIndex);

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
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
		// Get the column layout entry. If it wasn't found, return.
		const columnLayoutEntry = this._columnLayoutManager.getLayoutEntry(columnIndex);
		if (!columnLayoutEntry) {
			return;
		}

		// Get the row layout entry. If it wasn't found, return.
		const rowLayoutEntry = this._rowLayoutManager.getLayoutEntry(rowIndex);
		if (!rowLayoutEntry) {
			return;
		}

		// Initialize the scroll offset updated flag.
		let scrollOffsetUpdated = false;

		// If the column isn't visible, adjust the horizontal scroll offset to scroll to it.
		if (columnLayoutEntry.start < this._horizontalScrollOffset) {
			this._horizontalScrollOffset = columnLayoutEntry.start;
			scrollOffsetUpdated = true;
		} else if (columnLayoutEntry.end > this._horizontalScrollOffset + this.layoutWidth) {
			this._horizontalScrollOffset = columnIndex === this.columns - 1 ?
				this._horizontalScrollOffset = this.maximumHorizontalScrollOffset :
				this._horizontalScrollOffset = columnLayoutEntry.end - this.layoutWidth;
			scrollOffsetUpdated = true;
		}

		// If the row isn't visible, adjust the vertical scroll offset to scroll to it.
		if (rowLayoutEntry.start < this._verticalScrollOffset) {
			this._verticalScrollOffset = rowLayoutEntry.start;
			scrollOffsetUpdated = true;
		} else if (rowLayoutEntry.end > this._verticalScrollOffset + this.layoutHeight) {
			this._verticalScrollOffset = rowIndex === this._rowLayoutManager.lastIndex ?
				this._verticalScrollOffset = this.maximumVerticalScrollOffset :
				this._verticalScrollOffset = rowLayoutEntry.end - this.layoutHeight;
			scrollOffsetUpdated = true;
		}

		// If scroll offset was updated, fetch data and fire the onDidUpdate event.
		if (scrollOffsetUpdated) {
			// Fetch data.
			await this.fetchData();

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Scrolls tp the specified column.
	 * @param columnIndex The column index.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async scrollToColumn(columnIndex: number) {
		// If the column is pinned, return.
		if (this._columnLayoutManager.isPinnedIndex(columnIndex)) {
			return;
		}

		// Get the column layout entry. If it wasn't found, return.
		const columnLayoutEntry = this._columnLayoutManager.getLayoutEntry(columnIndex);
		if (!columnLayoutEntry) {
			return;
		}

		// If the column isn't visible, scroll to it.
		if (columnLayoutEntry.start < this._horizontalScrollOffset) {
			await this.setHorizontalScrollOffset(columnLayoutEntry.start);
		} else if (columnLayoutEntry.end > this._horizontalScrollOffset + this.layoutWidth) {
			await this.setHorizontalScrollOffset(columnLayoutEntry.end - this.layoutWidth);
		}
	}

	/**
	 * Scrolls to the specified row.
	 * @param rowIndex The row index.
	 */
	async scrollToRow(rowIndex: number) {
		// If the row is pinned, return.
		if (this._rowLayoutManager.isPinnedIndex(rowIndex)) {
			return;
		}

		// Get the row layout entry. If it wasn't found, return.
		const rowLayoutEntry = this._rowLayoutManager.getLayoutEntry(rowIndex);
		if (!rowLayoutEntry) {
			return;
		}

		// If the row isn't visible, scroll to it.
		if (rowLayoutEntry.start < this._verticalScrollOffset) {
			await this.setVerticalScrollOffset(rowLayoutEntry.start);
		} else if (rowLayoutEntry.end > this._verticalScrollOffset + this.layoutHeight) {
			await this.setVerticalScrollOffset(rowLayoutEntry.end - this.layoutHeight);
		}
	}

	/**
	 * Selects all.
	 */
	selectAll() {
		// Clear cell selection.
		this._cellSelectionIndexes = undefined;

		// Select all.
		this._columnSelectionIndexes = undefined;
		this._rowSelectionIndexes = undefined;

		// Get the column indexes for all columns.
		const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(0, this._columnLayoutManager.entryCount - 1);
		if (columnIndexes === undefined) {
			return;
		}

		// Get the row indexes for all rows.
		const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(0, this._rowLayoutManager.entryCount - 1);
		if (rowIndexes === undefined) {
			return;
		}

		// Set the cell selection indexes.
		this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Mouse selects a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @param selectionType The mouse selection type.
	 * @returns A Promise<boolean> that resolves when the operation is complete.
	 */
	async mouseSelectCell(
		columnIndex: number,
		rowIndex: number,
		pinned: boolean,
		selectionType: MouseSelectionType
	): Promise<void> {
		// Clear column selection.
		this._columnSelectionIndexes = undefined;

		// Clear row selection.
		this._rowSelectionIndexes = undefined;

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Clear cell selection.
				this._cellSelectionIndexes = undefined;

				// Adjust the cursor position.
				this.setCursorPosition(columnIndex, rowIndex);

				// If the cursor position isn't pinned, scroll to it.
				if (!pinned) {
					await this.scrollToCursor();
				}

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Get the cursor column position.
				const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
				if (cursorColumnPosition === undefined) {
					return;
				}

				// Get the column position.
				const columnPosition = this._columnLayoutManager.mapIndexToPosition(columnIndex);
				if (columnPosition === undefined) {
					return;
				}

				// Get the cursor row position.
				const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
				if (cursorRowPosition === undefined) {
					return;
				}

				// Get the row position.
				const rowPosition = this._rowLayoutManager.mapIndexToPosition(rowIndex);
				if (rowPosition === undefined) {
					return;
				}

				// Determine the first column position and the last column position.
				const firstColumnPosition = Math.min(cursorColumnPosition, columnPosition);
				const lastColumnPosition = Math.max(cursorColumnPosition, columnPosition);

				// Determine the first row position and the last row position.
				const firstRowPosition = Math.min(cursorRowPosition, rowPosition);
				const lastRowPosition = Math.max(cursorRowPosition, rowPosition);

				// Calculate the column indexes.
				const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition);
				if (columnIndexes === undefined) {
					return;
				}

				// Calculate the row indexes.
				const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition);
				if (rowIndexes === undefined) {
					return;
				}

				// Set the cell selection.
				this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

				// Scroll the cell into view.
				await this.scrollToCell(columnIndex, rowIndex);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
				break;
			}

			// Multi selection.
			case MouseSelectionType.Multi: {
				// Not supported at this time. Silently succeed.
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
		this._cellSelectionIndexes = undefined;

		// Clear row selection.
		this._rowSelectionIndexes = undefined;

		// Single select the column.
		this._columnSelectionIndexes = new SelectionIndexes([columnIndex]);

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Mouse selects a column.
	 * @param columnIndex The column index.
	 * @param selectionType The selection type.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async mouseSelectColumn(columnIndex: number, selectionType: MouseSelectionType): Promise<void> {
		// Clear cell selection.
		this._cellSelectionIndexes = undefined;

		// Clear row selection.
		this._rowSelectionIndexes = undefined;

		/**
		 * Adjusts the cursor.
		 * @param columnIndex The column index.
		 */
		const adjustCursor = async (columnIndex: number) => {
			// Adjust the cursor.
			this._cursorColumnIndex = columnIndex;
			this._cursorRowIndex = this.firstRow?.rowIndex ?? 0;
		};

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Single select the column.
				this._columnSelectionIndexes = new SelectionIndexes([columnIndex]);

				// Adjust the cursor and scroll to the column.
				await adjustCursor(columnIndex);
				await this.scrollToColumn(columnIndex);

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Get the cursor column position.
				const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
				if (cursorColumnPosition === undefined) {
					return;
				}

				// Get the column position.
				const columnPosition = this._columnLayoutManager.mapIndexToPosition(columnIndex);
				if (columnPosition === undefined) {
					return;
				}

				// Determine the first column position and the last column position.
				const firstColumnPosition = Math.min(cursorColumnPosition, columnPosition);
				const lastColumnPosition = Math.max(cursorColumnPosition, columnPosition);

				// Calculate the column indexes.
				const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition);
				if (columnIndexes === undefined) {
					return;
				}

				// Set the column selection indexes.
				this._columnSelectionIndexes = new SelectionIndexes(columnIndexes);

				// Update the waffle.
				await this.scrollToColumn(columnIndex);

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
				break;
			}

			// Multi selection.
			case MouseSelectionType.Multi: {
				// Build the column selection indexes.
				let indexes: number[] = [];
				if (this._columnSelectionIndexes === undefined) {
					indexes.push(columnIndex);
				} else {
					if (this._columnSelectionIndexes.contains(columnIndex)) {
						indexes = this._columnSelectionIndexes.indexes.filter(index => index !== columnIndex);
					} else {
						indexes = [...this._columnSelectionIndexes.indexes, columnIndex];
					}
				}

				// Set the column selection indexes.
				if (indexes.length === 0) {
					this._columnSelectionIndexes = undefined;
				} else {
					this._columnSelectionIndexes = new SelectionIndexes(indexes);
				}

				// Adjust the cursor.
				await adjustCursor(columnIndex);

				// Scroll to the column.
				await this.scrollToColumn(columnIndex);

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
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
		this._cellSelectionIndexes = undefined;

		// Clear column selection.
		this._columnSelectionIndexes = undefined;

		// Single select the row.
		this._rowSelectionIndexes = new SelectionIndexes([rowIndex]);

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Mouse selects a row.
	 * @param rowIndex The row index.
	 * @param selectionType The selection type.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	async mouseSelectRow(rowIndex: number, selectionType: MouseSelectionType): Promise<void> {
		// Clear cell selection.
		this._cellSelectionIndexes = undefined;

		// Clear column selection.
		this._columnSelectionIndexes = undefined;

		/**
		 * Adjust the cursor.
		 * @param rowIndex The row index.
		 */
		const adjustCursor = async (rowIndex: number) => {
			// Adjust the cursor.
			this._cursorColumnIndex = this.firstColumn?.columnIndex ?? 0;
			this._cursorRowIndex = rowIndex;
		};

		// Process the selection based on selection type.
		switch (selectionType) {
			// Single selection.
			case MouseSelectionType.Single: {
				// Single select the row.
				this._rowSelectionIndexes = new SelectionIndexes([rowIndex]);

				// Adjust the cursor and scroll to the row.
				await adjustCursor(rowIndex);
				await this.scrollToRow(rowIndex);

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
				break;
			}

			// Range selection.
			case MouseSelectionType.Range: {
				// Get the cursor row position.
				const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
				if (cursorRowPosition === undefined) {
					return;
				}

				// Get the row position.
				const rowPosition = this._rowLayoutManager.mapIndexToPosition(rowIndex);
				if (rowPosition === undefined) {
					return;
				}

				// Determine the first row position and the last row position.
				const firstRowPosition = Math.min(cursorRowPosition, rowPosition);
				const lastRowPosition = Math.max(cursorRowPosition, rowPosition);

				// Calculate the row indexes.
				const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition);
				if (rowIndexes === undefined) {
					return;
				}

				// Set the row selection indexes.
				this._rowSelectionIndexes = new SelectionIndexes(rowIndexes);

				// Scroll to the row.
				await this.scrollToRow(rowIndex);

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
				break;
			}

			// Multi selection.
			case MouseSelectionType.Multi: {
				// Build the row selection indexes.
				let indexes: number[] = [];
				if (this._rowSelectionIndexes === undefined) {
					indexes.push(rowIndex);
				} else {
					if (this._rowSelectionIndexes.contains(rowIndex)) {
						indexes = this._rowSelectionIndexes.indexes.filter(index => index !== rowIndex);
					} else {
						indexes = [...this._rowSelectionIndexes.indexes, rowIndex];
					}
				}

				// Set the row selection indexes.
				if (indexes.length === 0) {
					this._rowSelectionIndexes = undefined;
				} else {
					this._rowSelectionIndexes = new SelectionIndexes(indexes);
				}

				// Adjust the cursor.
				await adjustCursor(rowIndex);

				// Scroll to the row.
				await this.scrollToRow(rowIndex);

				// Fetch data.
				await this.fetchData();

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
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
		if (this._rowSelectionIndexes) {
			return;
		}

		// Process extend selection left based on what is currently selected.
		if (this._columnSelectionIndexes) {
			// Extend column selection left.
			if (this._columnSelectionIndexes.contains(this._cursorColumnIndex)) {
				// Get the cursor column position. If it's undefined, or the first column position, return.
				const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
				if (cursorColumnPosition === undefined || cursorColumnPosition === 0) {
					return;
				}

				// Get the previous column index.
				const previousColumnIndex = this._columnLayoutManager.mapPositionToIndex(cursorColumnPosition - 1);
				if (previousColumnIndex === undefined) {
					return;
				}

				// Move the cursor to the previous column index.
				this.setCursorColumn(previousColumnIndex);

				// Update the column selection indexes.
				if (!this._columnSelectionIndexes.contains(previousColumnIndex)) {
					this._columnSelectionIndexes = new SelectionIndexes([previousColumnIndex, ...this._columnSelectionIndexes.indexes]);
				}

				// Sroll to the column.
				this.scrollToColumn(previousColumnIndex);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else if (this._cellSelectionIndexes) {
			if (this._cursorColumnIndex === this._cellSelectionIndexes.lastColumnIndex) {
				// Get the first column position.
				const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
				if (!firstColumnPosition) {
					return;
				}

				// If the first column cannot be moved left, return.
				if (!(firstColumnPosition > 0)) {
					return;
				}

				// Get the last column position.
				const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
				if (lastColumnPosition === undefined) {
					return;
				}

				// Build the column indexes.
				const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition - 1, lastColumnPosition);
				if (columnIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, this._cellSelectionIndexes.rowIndexes);

				// Scroll to the column.
				this.scrollToColumn(columnIndexes[0]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			} else if (this._cursorColumnIndex === this._cellSelectionIndexes.firstColumnIndex) {
				// Get the first column position.
				const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
				if (firstColumnPosition === undefined) {
					return;
				}

				// Get the last column position.
				const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
				if (lastColumnPosition === undefined) {
					return;
				}

				// Build the column indexes.
				const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition - 1);
				if (columnIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, this._cellSelectionIndexes.rowIndexes);

				// Scroll to the column.
				this.scrollToColumn(columnIndexes[columnIndexes.length - 1]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else {
			// Get the cursor column position.
			const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
			if (cursorColumnPosition === undefined) {
				return;
			}

			// If the cursor column position cannot be moved left, return.
			if (!(cursorColumnPosition > 0)) {
				return;
			}

			// Get the cursor row position.
			const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
			if (cursorRowPosition === undefined) {
				return;
			}

			// Build the column indexes.
			const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition - 1, cursorColumnPosition)
			if (columnIndexes === undefined) {
				return;
			}

			// Build the row indexes.
			const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition, cursorRowPosition)
			if (rowIndexes === undefined) {
				return;
			}

			// Set the cell selection indexes.
			this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

			// Scroll to the cell.
			this.scrollToCell(columnIndexes[columnIndexes.length - 1], this._cursorRowIndex);

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Extends column selection right.
	 * @param extendColumnSelectionBy A value that describes how to extend the column selection.
	 */
	extendColumnSelectionRight(extendColumnSelectionBy: ExtendColumnSelectionBy) {
		// If there is a row selection, do nothing.
		if (this._rowSelectionIndexes) {
			return;
		}

		// Process extend selection right based on what is currently selected.
		if (this._columnSelectionIndexes) {
			// Extend column selection right.
			if (this._columnSelectionIndexes.contains(this._cursorColumnIndex)) {
				// Get the cursor column position. If it's undefined, or the last column position, return.
				const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
				if (cursorColumnPosition === undefined || cursorColumnPosition === this._columnLayoutManager.entryCount - 1) {
					return;
				}

				// Get the next column index.
				const nextColumnIndex = this._columnLayoutManager.mapPositionToIndex(cursorColumnPosition + 1);
				if (nextColumnIndex === undefined) {
					return;
				}

				// Move the cursor to the next column index.
				this.setCursorColumn(nextColumnIndex);

				// Update the column selection indexes.
				if (!this._columnSelectionIndexes.contains(nextColumnIndex)) {
					this._columnSelectionIndexes = new SelectionIndexes([...this._columnSelectionIndexes.indexes, nextColumnIndex]);
				}

				// Sroll to the column.
				this.scrollToColumn(nextColumnIndex);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else if (this._cellSelectionIndexes) {
			// Expand or contract the cell selection range along the column axis, if possible.
			if (this._cursorColumnIndex === this._cellSelectionIndexes.firstColumnIndex) {
				// Get the last column position.
				const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
				if (!lastColumnPosition) {
					return;
				}

				// If the last column cannot be moved right, return.
				if (!(lastColumnPosition < this._columnLayoutManager.entryCount - 1)) {
					return;
				}

				// Get the first column position.
				const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
				if (firstColumnPosition === undefined) {
					return;
				}

				// Build the column indexes.
				const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition + 1);
				if (columnIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, this._cellSelectionIndexes.rowIndexes);

				// Scroll to the column.
				this.scrollToColumn(columnIndexes[columnIndexes.length - 1]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			} else if (this._cursorColumnIndex === this._cellSelectionIndexes.lastColumnIndex) {
				// Get the first column position.
				const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
				if (firstColumnPosition === undefined) {
					return;
				}

				// Get the last column position.
				const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
				if (lastColumnPosition === undefined) {
					return;
				}

				// Build the column indexes.
				const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition + 1, lastColumnPosition);
				if (columnIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, this._cellSelectionIndexes.rowIndexes);

				// Scroll to the column.
				this.scrollToColumn(columnIndexes[columnIndexes.length - 1]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else {
			// Get the cursor column position.
			const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
			if (cursorColumnPosition === undefined) {
				return;
			}

			// If the cursor column position cannot be moved right, return.
			if (!(cursorColumnPosition < this._columnLayoutManager.entryCount - 1)) {
				return;
			}

			// Get the cursor row position.
			const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
			if (cursorRowPosition === undefined) {
				return;
			}

			// Build the column indexes.
			const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition, cursorColumnPosition + 1)
			if (columnIndexes === undefined) {
				return;
			}

			// Build the row indexes.
			const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition, cursorRowPosition)
			if (rowIndexes === undefined) {
				return;
			}

			// Set the cell selection indexes.
			this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

			// Scroll to the cell.
			this.scrollToCell(columnIndexes[columnIndexes.length - 1], this._cursorRowIndex);

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Extends row selection up.
	 * @param extendRowSelectionBy A value that describes how to extend the row selection.
	 */
	extendRowSelectionUp(extendRowSelectionBy: ExtendRowSelectionBy) {
		// If there is a column selection, do nothing.
		if (this._columnSelectionIndexes) {
			return;
		}

		// Process extend selection up based on what is currently selected.
		if (this._rowSelectionIndexes) {
			// Extend row selection up.
			if (this._rowSelectionIndexes.contains(this._cursorRowIndex)) {
				// Get the cursor row position. If it's undefined, or the first row position, return.
				const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
				if (cursorRowPosition === undefined || cursorRowPosition === 0) {
					return;
				}

				// Get the previous row index.
				const previousRowIndex = this._rowLayoutManager.mapPositionToIndex(cursorRowPosition - 1);
				if (previousRowIndex === undefined) {
					return;
				}

				// Move the cursor to the previous row index.
				this.setCursorRow(previousRowIndex);

				// Update the row selection indexes.
				if (!this._rowSelectionIndexes.contains(previousRowIndex)) {
					this._rowSelectionIndexes = new SelectionIndexes([previousRowIndex, ...this._rowSelectionIndexes.indexes]);
				}

				// Sroll to the row.
				this.scrollToRow(previousRowIndex);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else if (this._cellSelectionIndexes) {
			if (this._cursorRowIndex === this._cellSelectionIndexes.lastRowIndex) {
				// Get the first row position.
				const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
				if (!firstRowPosition) {
					return;
				}

				// If the first row cannot be moved up, return.
				if (!(firstRowPosition > 0)) {
					return;
				}

				// Get the last row position.
				const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
				if (lastRowPosition === undefined) {
					return;
				}

				// Build the row indexes.
				const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition - 1, lastRowPosition);
				if (rowIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(this._cellSelectionIndexes.columnIndexes, rowIndexes);

				// Scroll to the row.
				this.scrollToRow(rowIndexes[0]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			} else if (this._cursorRowIndex === this._cellSelectionIndexes.firstRowIndex) {
				// Get the first row position.
				const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
				if (firstRowPosition === undefined) {
					return;
				}

				// Get the last row position.
				const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
				if (lastRowPosition === undefined) {
					return;
				}

				// Build the row indexes.
				const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition - 1);
				if (rowIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(this._cellSelectionIndexes.columnIndexes, rowIndexes);

				// Scroll to the row.
				this.scrollToRow(rowIndexes[rowIndexes.length - 1]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else {
			// Get the cursor row position.
			const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
			if (!cursorRowPosition) {
				return;
			}

			// If the cursor row position cannot be moved up, return.
			if (!(cursorRowPosition > 0)) {
				return;
			}

			// Get the cursor column position.
			const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
			if (cursorColumnPosition === undefined) {
				return;
			}

			// Build the column indexes.
			const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition, cursorColumnPosition)
			if (columnIndexes === undefined) {
				return;
			}

			// Build the row indexes.
			const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition - 1, cursorRowPosition)
			if (rowIndexes === undefined) {
				return;
			}

			// Set the cell selection indexes.
			this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

			// Scroll to the cell.
			this.scrollToCell(this._cursorColumnIndex, this._cellSelectionIndexes.firstRowIndex);

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Extends row selection down.
	 * @param extendRowSelectionBy A value that describes how to extend the row selection.
	 */
	extendRowSelectionDown(extendRowSelectionBy: ExtendRowSelectionBy) {
		// If there is a column selection, do nothing.
		if (this._columnSelectionIndexes) {
			return;
		}

		// Process extend selection down based on what is currently selected.
		if (this._rowSelectionIndexes) {
			// Extend row selection down.
			if (this._rowSelectionIndexes.contains(this._cursorRowIndex)) {
				// Get the cursor row position. If it's undefined, or the last row position, return.
				const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
				if (cursorRowPosition === undefined || cursorRowPosition === this._rowLayoutManager.entryCount - 1) {
					return;
				}

				// Get the next row index.
				const nextRowIndex = this._rowLayoutManager.mapPositionToIndex(cursorRowPosition + 1);
				if (nextRowIndex === undefined) {
					return;
				}

				// Move the cursor to the next row index.
				this.setCursorRow(nextRowIndex);

				// Update the row selection indexes.
				if (!this._rowSelectionIndexes.contains(nextRowIndex)) {
					this._rowSelectionIndexes = new SelectionIndexes([...this._rowSelectionIndexes.indexes, nextRowIndex]);
				}

				// Sroll to the row.
				this.scrollToRow(nextRowIndex);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else if (this._cellSelectionIndexes) {
			// Expand or contract the row selection range along the row axis, if possible.
			if (this._cursorRowIndex === this._cellSelectionIndexes.firstRowIndex) {
				// Get the last row position.
				const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
				if (!lastRowPosition) {
					return;
				}

				// If the last row cannot be moved down, return.
				if (!(lastRowPosition < this._rowLayoutManager.entryCount - 1)) {
					return;
				}

				// Get the first row position.
				const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
				if (firstRowPosition === undefined) {
					return;
				}

				// Build the row indexes.
				const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition + 1);
				if (rowIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(this._cellSelectionIndexes.columnIndexes, rowIndexes);

				// Scroll to the row.
				this.scrollToRow(rowIndexes[rowIndexes.length - 1]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			} else if (this._cursorRowIndex === this._cellSelectionIndexes.lastRowIndex) {
				// Get the first row position.
				const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
				if (firstRowPosition === undefined) {
					return;
				}

				// Get the last row position.
				const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
				if (lastRowPosition === undefined) {
					return;
				}

				// Build the row indexes.
				const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition + 1, lastRowPosition);
				if (rowIndexes === undefined) {
					return;
				}

				// Set the cell selection indexes.
				this._cellSelectionIndexes = new CellSelectionIndexes(this._cellSelectionIndexes.columnIndexes, rowIndexes);

				// Scroll to the row.
				this.scrollToRow(rowIndexes[0]);

				// Fire the onDidUpdate event.
				this.fireOnDidUpdateEvent();
			}
		} else {
			// Get the cursor row position.
			const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
			if (cursorRowPosition === undefined) {
				return;
			}

			// If the cursor column position cannot be moved down, return.
			if (!(cursorRowPosition < this._rowLayoutManager.entryCount - 1)) {
				return;
			}

			// Get the cursor column position.
			const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
			if (cursorColumnPosition === undefined) {
				return;
			}

			// Build the column indexes.
			const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition, cursorColumnPosition)
			if (columnIndexes === undefined) {
				return;
			}

			// Build the row indexes.
			const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition, cursorRowPosition + 1)
			if (rowIndexes === undefined) {
				return;
			}

			// Set the cell selection indexes.
			this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

			// Scroll to the cell.
			this.scrollToCell(this._cursorColumnIndex, rowIndexes[rowIndexes.length - 1]);

			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Returns the cell selection state.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns A CellSelectionState that represents the cell selection state.
	 */
	cellSelectionState(columnIndex: number, rowIndex: number) {
		// If there isn't a cell selection, return the column selection state or the row selection state.
		if (!this._cellSelectionIndexes) {
			// Return the column selection state.
			let columnSelectionState = this.columnSelectionState(columnIndex);
			if (columnSelectionState !== ColumnSelectionState.None) {
				// If the row index is the last index, set the selected bottom bit.
				if (rowIndex === this._rowLayoutManager.lastIndex) {
					columnSelectionState |= RowSelectionState.SelectedBottom;
				}

				// Return the column selection state.
				return columnSelectionState;
			}

			// Return the row selection state.
			const rowSelectionState = this.rowSelectionState(rowIndex);
			if (rowSelectionState !== RowSelectionState.None) {
				// If the column index is the last index, set the selected right bit.
				if (columnIndex === this._columnLayoutManager.lastIndex) {
					columnSelectionState |= ColumnSelectionState.SelectedRight;
				}

				// Return the row selection state.
				return rowSelectionState;
			}

			// The cell is not selected.
			return CellSelectionState.None;
		}

		// If the cell is selected, return the cell selection state.
		if (this._cellSelectionIndexes.contains(columnIndex, rowIndex)) {
			// Set the selected bit.
			let cellSelectionState = CellSelectionState.Selected;

			// If the column index is the first selected column index, set the selected left bit.
			if (columnIndex === this._cellSelectionIndexes.firstColumnIndex) {
				cellSelectionState |= CellSelectionState.SelectedLeft;
			}

			// If the column index is the last selected column index, set the selected right bit.
			if (columnIndex === this._cellSelectionIndexes.lastColumnIndex) {
				cellSelectionState |= CellSelectionState.SelectedRight;
			}

			// If the row index is the first selected row index, set the selected top bit.
			if (rowIndex === this._cellSelectionIndexes.firstRowIndex) {
				cellSelectionState |= CellSelectionState.SelectedTop;
			}

			// If the row index is the last selected row index, set the selected bottom bit.
			if (rowIndex === this._cellSelectionIndexes.lastRowIndex) {
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
	 * @returns A ColumnSelectionState that represents the column selection state.
	 */
	columnSelectionState(columnIndex: number) {
		// If the column isn't selected, return none.
		if (this._columnSelectionIndexes === undefined || !this._columnSelectionIndexes.contains(columnIndex)) {
			return ColumnSelectionState.None;
		} else {
			return ColumnSelectionState.Selected | ColumnSelectionState.SelectedLeft | ColumnSelectionState.SelectedRight;
		}
	}

	/**
	 * Returns the row selection state.
	 * @param rowIndex The row index.
	 * @returns A RowSelectionState that represents the row selection state.
	 */
	rowSelectionState(rowIndex: number) {
		// If the row isn't selected, return none.
		if (this._rowSelectionIndexes === undefined || !this._rowSelectionIndexes.contains(rowIndex)) {
			return RowSelectionState.None;
		} else {
			return RowSelectionState.Selected | RowSelectionState.SelectedTop | RowSelectionState.SelectedBottom;
		}
	}

	/**
	 * Clears selection.
	 */
	clearSelection() {
		// Clear cell selection.
		this._cellSelectionIndexes = undefined;

		// Clear column selection.
		this._columnSelectionIndexes = undefined;

		// Clear row selection.
		this._rowSelectionIndexes = undefined;

		// Fire the onDidUpdate event.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Gets the clipboard data.
	 * @returns The clipboard data, if it's available; otherwise, undefined.
	 */
	getClipboardData(): ClipboardData | undefined {
		// Cell selection range.
		if (this._cellSelectionIndexes) {
			return new ClipboardCellIndexes(this._cellSelectionIndexes.columnIndexes, this._cellSelectionIndexes.rowIndexes);
		}

		/**
		 * Sorts selection indexes by position.
		 * @param selectionIndexes The selection indexes.
		 * @param layoutManager The layout manager.
		 * @returns The selection indexes sorted by position.
		 */
		const sortSelectionIndexesByPosition = (selectionIndexes: number[], layoutManager: LayoutManager) => {
			// Order the selections.
			const positionIndexes: PositionIndex[] = [];
			for (let i = 0; i < selectionIndexes.length; i++) {
				// Get the column index and column position.
				const index = selectionIndexes[i];
				const position = layoutManager.mapIndexToPosition(index);
				if (position === undefined) {
					return selectionIndexes;
				}

				// Push the position index.
				positionIndexes.push({
					position,
					index
				});
			}

			// Return the sorted indexes.
			return positionIndexes.sort((a, b) => a.position - b.position).map(positionIndex => positionIndex.index);
		};

		// Column selection.
		if (this._columnSelectionIndexes) {
			// Get the column selection indexes.
			const columnSelectionIndexes = this._columnSelectionIndexes.indexes;
			if (columnSelectionIndexes.length === 0) {
				return;
			}

			// Get the row indexes.
			const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(0, this._rowLayoutManager.entryCount - 1);
			if (rowIndexes === undefined) {
				return;
			}

			// Return the clipboard cell indexes.
			return new ClipboardCellIndexes(
				sortSelectionIndexesByPosition(columnSelectionIndexes, this._columnLayoutManager),
				rowIndexes
			);
		}

		// Row selection.
		if (this._rowSelectionIndexes) {
			// Get the row selection indexes.
			const rowSelectionIndexes = this._rowSelectionIndexes.indexes;
			if (rowSelectionIndexes.length === 0) {
				return;
			}

			// Get the column indexes.
			const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(0, this._columnLayoutManager.entryCount - 1);
			if (columnIndexes === undefined) {
				return;
			}

			// Return the clipboard cell indexes.
			return new ClipboardCellIndexes(
				columnIndexes,
				sortSelectionIndexesByPosition(rowSelectionIndexes, this._rowLayoutManager)
			);
		}

		// Cursor cell.
		if (this._cursorColumnIndex >= 0 && this._cursorRowIndex >= 0) {
			return new ClipboardCell(this._cursorColumnIndex, this._cursorRowIndex);
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
	 * @param columnIndex The column index.
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
	 * Performs a soft reset of the data grid.
	 */
	protected softReset() {
		this._horizontalScrollOffset = 0;
		this._verticalScrollOffset = 0;
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
	 * Resets the selection of the data grid.
	 */
	protected resetSelection() {
		this._cellSelectionIndexes = undefined;
		this._columnSelectionIndexes = undefined;
		this._rowSelectionIndexes = undefined;
	}

	/**
	 * Fires the onDidUpdate event.
	 */
	protected fireOnDidUpdateEvent() {
		// If the onDidUpdate event has already been fired, do nothing.
		if (this._pendingOnDidUpdateEvent) {
			return;
		}

		// Set the pending flag.
		this._pendingOnDidUpdateEvent = true;

		// Fire the event in a microtask.
		Promise.resolve().then(() => {
			// Clear the pending flag.
			this._pendingOnDidUpdateEvent = false;

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		});
	}

	//#endregion Protected Methods

	//#region Private Methods

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
