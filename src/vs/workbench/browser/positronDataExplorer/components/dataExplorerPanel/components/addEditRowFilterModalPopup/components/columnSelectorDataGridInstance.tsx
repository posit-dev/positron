/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { ColumnSelectorCell } from './columnSelectorCell.js';
import { Emitter } from '../../../../../../../../base/common/event.js';
import { DataGridInstance } from '../../../../../../positronDataGrid/classes/dataGridInstance.js';
import { ColumnSchemaCache } from '../../../../../../../services/positronDataExplorer/common/columnSchemaCache.js';
import { BackendState, ColumnSchema } from '../../../../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { DataExplorerClientInstance } from '../../../../../../../services/languageRuntime/common/languageRuntimeDataExplorerClient.js';

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
	 * Gets or sets the backend state.
	 */
	private _backendState: BackendState;

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

	//#region Static Methods

	/**
	 * Creates a new column selector data grid instance.
	 * @param dataExplorerClientInstance The data explorer client instance.
	 * @returns A Promise<ColumnSelectorDataGridInstance> that resolves when the operation is
	 * complete.
	 */
	public static async create(
		dataExplorerClientInstance: DataExplorerClientInstance,
	): Promise<ColumnSelectorDataGridInstance | undefined> {
		try {
			// Get the backend state so that we can get the initial number of columns.
			const backendState = await dataExplorerClientInstance.getBackendState();

			// Return a new instance of the column selector data grid instance.
			return new ColumnSelectorDataGridInstance(
				backendState,
				dataExplorerClientInstance
			);
		} catch {
			return undefined;
		}
	}

	//#endregion Static Methods

	//#region Constructor

	/**
	 * Constructor.
	 * @param backendState The initial backend state.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 */
	private constructor(
		backendState: BackendState,
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance,
	) {
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

		// Set the backend state.
		this._backendState = backendState;

		// Create the column schema cache.
		this._register(
			this._columnSchemaCache = new ColumnSchemaCache(this._dataExplorerClientInstance)
		);

		// Set the initial layout entries in the row layout manager.
		this._rowLayoutManager.setLayoutEntries(backendState.table_shape.num_columns);

		/**
		 * Updates the data grid instance.
		 * @param backendState The backend state, if known; otherwise, undefined.
		 */
		const updateDataGridInstance = async (backendState?: BackendState) => {
			// Get the backend state, if it was not supplied.
			if (!backendState) {
				backendState = await this._dataExplorerClientInstance.getBackendState();
			}

			// Update the backend state.
			this._backendState = backendState;

			// Set the layout entries in the row layout manager.
			this._rowLayoutManager.setLayoutEntries(backendState.table_shape.num_columns);

			// Scroll to the top.
			await this.setScrollOffsets(0, 0);
		};

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () =>
			// Update the data grid instance.
			updateDataGridInstance()
		));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () =>
			// Update the data grid instance.
			updateDataGridInstance
		));

		// Add the onDidUpdateBackendState event handler.
		this._register(
			this._dataExplorerClientInstance.onDidUpdateBackendState(async backendState =>
				// Update the data grid instance.
				updateDataGridInstance(backendState)
			)
		);

		// Add the onDidUpdateCache event handler.
		this._register(this._columnSchemaCache.onDidUpdateCache(() =>
			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire()
		));
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
		return this._backendState.table_shape.num_columns;
	}

	/**
	 * Gets the scroll width.
	 */
	override get scrollWidth() {
		return 0;
	}

	/**
	 * Gets the first column.
	 */
	override get firstColumn() {
		return {
			columnIndex: 0,
			left: 0
		};
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Fetches data.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData() {
		const rowDescriptor = this.firstRow;
		if (rowDescriptor) {
			await this._columnSchemaCache.update({
				searchText: this._searchText,
				firstColumnIndex: rowDescriptor.rowIndex,
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
				columnIndex={rowIndex}
				columnSchema={columnSchema}
				instance={this}
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
