/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { Emitter } from 'vs/base/common/event';
import { DataGridInstance } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ColumnSchemaCache } from 'vs/workbench/services/positronDataExplorer/common/columnSchemaCache';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { ColumnSelectorCell } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/columnSelectorCell';

/**
 * Constants.
 */
const ROW_HEIGHT = 26;

/**
 * ColumnSelectorDataGridInstance class.
 */
export class ColumnSelectorDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	/**
	 * Gets or sets the search text.
	 */
	private _searchText?: string;

	/**
	 * Gets the column schema cache.
	 */
	private readonly _columnSchemaCache: ColumnSchemaCache;

	/**
	 * The onDidSelectColumn event emitter.
	 */
	private readonly _onDidSelectColumnEmitter = this._register(new Emitter<ColumnSchema>);

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance.
	 */
	constructor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super({
			columnHeaders: false,
			rowHeaders: false,
			defaultColumnWidth: 0,
			defaultRowHeight: ROW_HEIGHT,
			columnResize: false,
			rowResize: false,
			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarThickness: 8,
			scrollbarOverscroll: 0,
			useEditorFont: false,
			automaticLayout: true,
			rowsMargin: 4,
			cellBorders: false,
			cursorInitiallyHidden: true,
			internalCursor: false,
			selection: false
		});

		// Set the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;

		// Allocate and initialize the column schema cache.
		this._columnSchemaCache = new ColumnSchemaCache(dataExplorerClientInstance);
		this._register(this._columnSchemaCache.onDidUpdateCache(() =>
			this._onDidUpdateEmitter.fire()
		));

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			await this.setScrollOffsets(0, 0);
		}));
	}

	//#endregion Constructor

	//#region DataGridInstance Properties

	/**
	 * Gets the number of columns.
	 */
	get columns() {
		return 1;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._columnSchemaCache.columns;
	}

	/**
	 * Gets the scroll width.
	 */
	override get scrollWidth() {
		return 0;
	}

	/**
	 * Gets the scroll height.
	 */
	override get scrollHeight() {
		return this.rows * this.defaultRowHeight;
	}

	/**
	 * Gets the number of columns.
	 */
	override get firstColumnLayoutEntry() {
		return {
			index: 0,
			start: 0,
			size: this.layoutWidth,
			end: this.layoutWidth
		};
	}

	/**
	 * Gets the first row layout entry.
	 */
	override get firstRowLayoutEntry() {
		const index = Math.floor(
			this.verticalScrollOffset / this.defaultRowHeight
		);

		const start = (index * this.defaultRowHeight) - this.verticalScrollOffset;
		return {
			index,
			start,
			size: this.defaultRowHeight,
			end: start + this.defaultRowHeight
		};
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Fetches data.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData() {
		const rowLayoutEntry = this.firstRowLayoutEntry;
		if (rowLayoutEntry) {
			await this._columnSchemaCache.update({
				searchText: this._searchText,
				firstColumnIndex: rowLayoutEntry.index,
				visibleColumns: this.screenRows
			});
		}
	}

	/**
	 * Gets the width of a column.
	 * @param columnIndex The column index.
	 */
	override getColumnWidth(columnIndex: number): number {
		return this.layoutWidth - 8;
	}

	/**
	 * Gets the height of a row.
	 * @param rowIndex The row index.
	 */
	override getRowHeight(rowIndex: number): number {
		return ROW_HEIGHT;
	}

	selectItem(rowIndex: number): void {
		// Get the column schema for the row index.
		const columnSchema = this._columnSchemaCache.getColumnSchema(rowIndex);
		if (!columnSchema) { return; }

		this._onDidSelectColumnEmitter.fire(columnSchema);
	}

	/**
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// Column index must be 0.
		if (columnIndex !== 0) {
			return undefined;
		}

		// Get the column schema for the row index.
		const columnSchema = this._columnSchemaCache.getColumnSchema(rowIndex);
		if (!columnSchema) {
			return undefined;
		}

		// Return the cell.
		return (
			<ColumnSelectorCell
				instance={this}
				columnSchema={columnSchema}
				columnIndex={rowIndex}
				onPressed={() => this._onDidSelectColumnEmitter.fire(columnSchema)}
			/>
		);
	}

	//#endregion DataGridInstance Methods

	//#region Public Events

	/**
	 * onDidSelectColumn event.
	 */
	readonly onDidSelectColumn = this._onDidSelectColumnEmitter.event;

	//#endregion Public Events

	//#region Public Methods

	async setSearchText(searchText?: string): Promise<void> {
		// When the search text changes, perform a soft reset and search.
		if (searchText !== this._searchText) {
			// Each search performs a soft reset.
			this.softReset();

			// Set the search text and fetch data.
			this._searchText = searchText;
			await this.fetchData();

			// select the first available row after fetching so that users cat hit "enter"
			// to make an immediate confirmation on what they were searching for
			if (this.rows > 0) {
				this.showCursor();
				this.setCursorRow(0);
			}
		}
	}

	//#endregion Public Methods
}
