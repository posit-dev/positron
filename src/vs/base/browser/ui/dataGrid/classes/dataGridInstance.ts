/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IDataColumn } from 'vs/base/browser/ui/dataGrid/interfaces/dataColumn';
import { IColumnSortKey } from 'vs/base/browser/ui/dataGrid/interfaces/columnSortKey';
import { IDataGridInstance, MouseSelectionType, SelectionState } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';

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
 * DataGridInstance class.
 */
export abstract class DataGridInstance extends Disposable implements IDataGridInstance {
	//#region Private Properties

	/**
	 * Gets or sets the column headers height.
	 */
	private _columnHeadersHeight: number;

	/**
	 * Gets or sets the row headers width.
	 */
	private _rowHeadersWidth: number;

	/**
	 * Gets or sets the minimum column width
	 */
	private _minimumColumnWidth: number;

	/**
	 * Gets or sets the row height.
	 */
	private _rowHeight = 24;

	/**
	 * Gets or sets the scrollbar width.
	 */
	private _scrollbarWidth: number;

	/**
	 * Gets or sets the columns.
	 */
	private _columns: IDataColumn[] = [];

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
	constructor(options: {
		columnHeadersHeight: number;
		rowHeadersWidth: number;
		minimumColumnWidth: number;
		scrollbarWidth: number;
	}) {
		// Call the base class's constructor.
		super();

		// Set the options.
		this._columnHeadersHeight = options.columnHeadersHeight;
		this._rowHeadersWidth = options.rowHeadersWidth;
		this._minimumColumnWidth = options.minimumColumnWidth;
		this._scrollbarWidth = options.scrollbarWidth;
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets the column headers height.
	 */
	get columnHeadersHeight() {
		return this._columnHeadersHeight;
	}

	/**
	 * Gets the row headers width.
	 */
	get rowHeadersWidth() {
		return this._rowHeadersWidth;
	}

	/**
	 * Gets the minimum column width.
	 */
	get minimumColumnWidth() {
		return this._minimumColumnWidth;
	}

	/**
	 * Gets the row height.
	 */
	get rowHeight() {
		return this._rowHeight;
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
	get columns() {
		return this._columns.length;
	}

	/**
	 * Gets the number of rows.
	 */
	abstract get rows(): number;

	/**
	 * Gets the layout width.
	 */
	get layoutWidth() {
		return this._width - this._rowHeadersWidth - this._scrollbarWidth;
	}

	/**
	 * Gets the layout height.
	 */
	get layoutHeight() {
		return this._height - this._columnHeadersHeight - this._scrollbarWidth;
	}

	/**
	 * Gets the visible columns.
	 */
	get visibleColumns() {
		let visibleColumns = 0;
		let columnIndex = this._firstColumnIndex;
		let availableLayoutWidth = this.layoutWidth;
		while (columnIndex < this._columns.length) {
			const column = this._columns[columnIndex];
			if (column.width > availableLayoutWidth) {
				break;
			}

			visibleColumns++;
			columnIndex++;
			availableLayoutWidth -= column.width;
		}

		// Done.
		return Math.max(visibleColumns, 1);
	}

	/**
	 * Gets the visible rows.
	 */
	get visibleRows() {
		return Math.max(Math.floor(this.layoutHeight / this._rowHeight), 1);
	}

	/**
	 * Gets the maximum first column.
	 */
	get maximumFirstColumnIndex() {
		// Calculate the maximum first column by looking backward through the columns for the last
		// column that fits.
		let maximumFirstColumn = this.columns - 1;
		for (let columnIndex = maximumFirstColumn - 1; columnIndex >= 0; columnIndex--) {
			if (this._columns[columnIndex].layoutWidth < this.layoutWidth) {
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
		return Math.max(this.rows - this.visibleRows, 0);
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
	 * Sets the columns.
	 * @param columns The columns.
	 */
	public setColumns(columns: IDataColumn[]) {
		// Set the columns.
		this._columns = columns;

		// Calculates the layout widths of the columns.
		this.calculateColumnLayoutWidths(this._columns.length - 1);
	}

	/**
	 * Sets the width of a column.
	 * @param columnIndex The column index.
	 * @param width The width.
	 */
	setColumnWidth(columnIndex: number, width: number) {
		if (width !== this._columns[columnIndex].width) {
			// Set the column width.
			this._columns[columnIndex].width = width;
			this.calculateColumnLayoutWidths(columnIndex);

			// Fetch data.
			this.fetchData();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
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
		// Clear the column sort keys.
		this._columnSortKeys.clear();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Sort the data.
		await this.doSortData();
	}

	/**
	 * Sets the screen size.
	 * @param width The width.
	 * @param height The height.
	 */
	setScreenSize(width: number, height: number) {
		this._width = width;
		this._height = height;

		// Fetch data.
		this.fetchData();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
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
	 * Clears selection.
	 */
	clearSelection() {
		// Clear selection.
		this._columnSelectionRange = undefined;
		this._columnSelectionIndexes.clear();
		this._rowSelectionRange = undefined;
		this._rowSelectionIndexes.clear();

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Selects all.
	 */
	selectAll() {
		// Clear selection.
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
	 * Selects a column.
	 * @param columnIndex The column index.
	 */
	selectColumn(columnIndex: number) {
		// Clear the row selection.
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
		// Clear the row selection.
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
		// Clear the column selection.
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
		// Clear the column selection.
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
	 * Extends selection left.
	 */
	extendSelectionLeft() {
		// If there is a row selection active, do nothing.
		if (this._rowSelectionRange || this._rowSelectionIndexes.size) {
			return;
		}

		// The cursor is on an individually-selected column.
		if (this._columnSelectionIndexes.has(this._cursorColumnIndex)) {
			// Do nothing when the cursor column is the first column.
			if (this._cursorColumnIndex === 0) {
				return;
			}

			// Adjust the column selection and clear individually-selected columns.
			this._columnSelectionRange = {
				firstColumnIndex: this._cursorColumnIndex - 1,
				lastColumnIndex: this._cursorColumnIndex
			};
			this._columnSelectionIndexes.clear();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();

			// Done.
			return;
		}

		// There is a selection range. Determine how to process the event.
		if (this._columnSelectionRange) {
			// If the cursor column is the last selected column index, try to extend selection.
			if (this._cursorColumnIndex === this._columnSelectionRange.lastColumnIndex) {
				// If the selection can be extended, extend it.
				if (this._columnSelectionRange.firstColumnIndex > 0) {
					// Extend the selecton range.
					this._columnSelectionRange.firstColumnIndex--;

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}

				// Done.
				return;
			}

			// If the cursor column is the first selected column index, try to contract selection.
			if (this._cursorColumnIndex === this._columnSelectionRange.firstColumnIndex) {
				// Contract the selecton range.
				this._columnSelectionRange.lastColumnIndex--;

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();

				// Done.
				return;
			}
		}
	}

	/**
	 * Extends selection right.
	 */
	extendSelectionRight() {
		// If there is a row selection active, do nothing.
		if (this._rowSelectionRange || this._rowSelectionIndexes.size) {
			return;
		}

		// The cursor is on an individually-selected column.
		if (this._columnSelectionIndexes.has(this._cursorColumnIndex)) {
			// Do nothing when the cursor column is the last column.
			if (this._cursorColumnIndex === this._columns.length - 1) {
				return;
			}

			// Adjust the column selection and clear individually-selected columns.
			this._columnSelectionRange = {
				firstColumnIndex: this._cursorColumnIndex,
				lastColumnIndex: this._cursorColumnIndex + 1
			};
			this._columnSelectionIndexes.clear();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();

			// Done.
			return;
		}

		// There is a selection range. Determine how to process the event.
		if (this._columnSelectionRange) {
			// If the cursor column is the first selected column index, try to extend selection.
			if (this._cursorColumnIndex === this._columnSelectionRange.firstColumnIndex) {
				// If the selection can be extended, extend it.
				if (this._columnSelectionRange.lastColumnIndex < this._columns.length - 1) {
					// Extend the selecton range.
					this._columnSelectionRange.lastColumnIndex++;

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}

				// Done.
				return;
			}

			// If the cursor column is the first selected column index, try to contract selection.
			if (this._cursorColumnIndex === this._columnSelectionRange.lastColumnIndex) {
				// Contract the selecton range.
				this._columnSelectionRange.firstColumnIndex++;

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();

				// Done.
				return;
			}
		}
	}

	/**
	 * Extends selection up.
	 */
	extendSelectionUp() {
		// If there is a column selection active, do nothing.
		if (this._columnSelectionRange || this._columnSelectionIndexes.size) {
			return;
		}

		// The cursor is on an individually-selected row.
		if (this._rowSelectionIndexes.has(this._cursorRowIndex)) {
			// Do nothing when the cursor row is the first row.
			if (this._cursorRowIndex === 0) {
				return;
			}

			// Adjust the row selection and clear individually-selected rows.
			this._rowSelectionRange = {
				firstRowIndex: this._cursorRowIndex - 1,
				lastRowIndex: this._cursorRowIndex
			};
			this._rowSelectionIndexes.clear();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();

			// Done.
			return;
		}

		// There is a selection range. Determine how to process the event.
		if (this._rowSelectionRange) {
			// If the cursor row is the last selected row index, try to extend selection.
			if (this._cursorRowIndex === this._rowSelectionRange.lastRowIndex) {
				// If the selection can be extended, extend it.
				if (this._rowSelectionRange.firstRowIndex > 0) {
					// Extend the selecton range.
					this._rowSelectionRange.firstRowIndex--;

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}

				// Done.
				return;
			}

			// If the cursor row is the first selected row index, try to contract selection.
			if (this._cursorRowIndex === this._rowSelectionRange.firstRowIndex) {
				// Contract the selecton range.
				this._rowSelectionRange.lastRowIndex--;

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();

				// Done.
				return;
			}
		}
	}

	/**
	 * Extends selection down.
	 */
	extendSelectionDown() {
		// If there is a column selection active, do nothing.
		if (this._columnSelectionRange || this._columnSelectionIndexes.size) {
			return;
		}

		// The cursor is on an individually-selected row.
		if (this._rowSelectionIndexes.has(this._cursorRowIndex)) {
			// Do nothing when the cursor row is the last row.
			if (this._cursorRowIndex === this.rows - 1) {
				return;
			}

			// Adjust the row selection and clear individually-selected rows.
			this._rowSelectionRange = {
				firstRowIndex: this._cursorRowIndex,
				lastRowIndex: this._cursorRowIndex + 1
			};
			this._rowSelectionIndexes.clear();

			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();

			// Done.
			return;
		}

		// There is a selection range. Determine how to process the event.
		if (this._rowSelectionRange) {
			// If the cursor row is the first selected row index, try to extend selection.
			if (this._cursorRowIndex === this._rowSelectionRange.firstRowIndex) {
				// If the selection can be extended, extend it.
				if (this._rowSelectionRange.lastRowIndex < this.rows - 1) {
					// Extend the selecton range.
					this._rowSelectionRange.lastRowIndex++;

					// Fire the onDidUpdate event.
					this._onDidUpdateEmitter.fire();
				}

				// Done.
				return;
			}

			// If the cursor row is the first selected row index, try to contract selection.
			if (this._cursorRowIndex === this._rowSelectionRange.lastRowIndex) {
				// Contract the selecton range.
				this._rowSelectionRange.firstRowIndex++;

				// Fire the onDidUpdate event.
				this._onDidUpdateEmitter.fire();

				// Done.
				return;
			}
		}
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
			let selectionState = SelectionState.Selected;

			// See if the column index is the first selected column index in a range.
			if (!this._columnSelectionIndexes.has(columnIndex - 1)) {
				selectionState |= SelectionState.FirstSelected;
			}

			// See if the column index is the last selected column index in a range.
			if (!this._columnSelectionIndexes.has(columnIndex + 1)) {
				selectionState |= SelectionState.LastSelected;
			}

			// Return the selection state.
			return selectionState;
		}

		// See if the column index is in the column selection range.
		if (this._columnSelectionRange &&
			columnIndex >= this._columnSelectionRange.firstColumnIndex &&
			columnIndex <= this._columnSelectionRange.lastColumnIndex) {
			// The column index is selected.
			let selectionState = SelectionState.Selected;

			// See if the column index is the first selected column index.
			if (columnIndex === this._columnSelectionRange.firstColumnIndex) {
				selectionState |= SelectionState.FirstSelected;
			}

			// See if the column index is the last selected column index.
			if (columnIndex === this._columnSelectionRange.lastColumnIndex) {
				selectionState |= SelectionState.LastSelected;
			}

			// Return the selection state.
			return selectionState;
		}

		// The column is not selected.
		return SelectionState.None;
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
			let selectionState = SelectionState.Selected;

			// See if the row index is the first row index in a range.
			if (!this._rowSelectionIndexes.has(rowIndex - 1)) {
				selectionState |= SelectionState.FirstSelected;
			}

			// See if the row index is the last row index in a range.
			if (!this._rowSelectionIndexes.has(rowIndex + 1)) {
				selectionState |= SelectionState.LastSelected;
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
			let selectionState = SelectionState.Selected;

			// See if the row index is the first selected row index.
			if (rowIndex === this._rowSelectionRange.firstRowIndex) {
				selectionState |= SelectionState.FirstSelected;
			}

			// See if the row index is the last selected row index.
			if (rowIndex === this._rowSelectionRange.lastRowIndex) {
				selectionState |= SelectionState.LastSelected;
			}

			// Return the selection state.
			return selectionState;
		}

		// The row is not selected.
		return SelectionState.None;
	}

	/**
	 * Returns a column.
	 * @param columnIndex The column index.
	 * @returns An IDataColumn that represents the column.
	 */
	column(columnIndex: number): IDataColumn {
		return this._columns[columnIndex];
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
	 *
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
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	abstract cell(columnIndex: number, rowIndex: number): string | undefined;

	/**
	 * onDidUpdate event.
	 */
	readonly onDidUpdate = this._onDidUpdateEmitter.event;

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Calculates the layout widths of the columns starting at the specified column.
	 * @param columnIndex The column index.
	 */
	private calculateColumnLayoutWidths(columnIndex: number) {
		// Set the previous width.
		let previousWidth = columnIndex < this._columns.length - 1 ?
			this._columns[columnIndex + 1].layoutWidth :
			0;

		// Calculate the layout widths of the columns starting at the specified column.
		for (let i = columnIndex; i >= 0; i--) {
			// Get the column.
			const column = this._columns[i];

			// Set the column's layout width.
			previousWidth = column.layoutWidth = previousWidth + column.width;
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
