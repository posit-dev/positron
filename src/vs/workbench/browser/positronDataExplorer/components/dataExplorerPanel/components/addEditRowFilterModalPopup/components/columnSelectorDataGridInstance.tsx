/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
			defaultColumnWidth: 100,
			defaultRowHeight: ROW_HEIGHT,
			columnResize: false,
			rowResize: false,
			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarWidth: 8,
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
			this.setScreenPosition(0, 0);
			this.fetchData();
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

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Fetches data.
	 */
	override fetchData() {
		this._columnSchemaCache.updateCache({
			searchText: this._searchText,
			firstColumnIndex: this.firstRowIndex,
			visibleColumns: this.screenRows
		});
	}

	/**
	 * Gets the the width of a column.
	 * @param columnIndex The column index.
	 */
	override getColumnWidth(columnIndex: number): number {
		return this.layoutWidth - 8;
	}

	/**
	 * Gets the the height of a row.
	 * @param rowIndex The row index.
	 */
	override getRowHeight(rowIndex: number): number {
		return ROW_HEIGHT;
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
			this.fetchData();
		}
	}

	//#endregion Public Methods
}
