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
const OVERSCAN_FACTOR = 3

/**
 * ColumnSelectorDataGridInstance class.
 *
 * This class is used to display a list of the column names from a dataset
 * in the column selector modal popup. The column selector modal popup is
 * a DataGridWaffle component. This instance manages the list of columns
 * and supports searching for columns by name.
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
			columnPinning: false,
			rowPinning: false,
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

		// Set the column layout entries. There is always one column.
		// The single column contains all the column names.
		this._columnLayoutManager.setEntries(1);

		// Set the row layout entries.
		this._rowLayoutManager.setEntries(backendState.table_shape.num_columns);

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Update the layout entries.
			await this.updateLayoutEntries()

			// Perform a soft reset.
			this.softReset();

			// Fetch data.
			await this.fetchData(true);
		}));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			// Update the layout entries.
			await this.updateLayoutEntries()

			// Fetch data.
			await this.fetchData(true);
		}));

		// Add the onDidUpdateBackendState event handler.
		this._register(this._dataExplorerClientInstance.onDidUpdateBackendState(async backendState => {
			// Update the data grid instance.
			await this.updateLayoutEntries(backendState);
			await this.fetchData(true);
		}));

		// Add the onDidUpdateCache event handler.
		this._register(this._columnSchemaCache.onDidUpdateCache(() =>
			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent()
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
			left: 0,
			width: 0,
		};
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Fetches data.
	 * @param invalidateCache A value which indicates whether to invalidate the cache.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData(invalidateCache?: boolean) {
		const rowDescriptor = this.firstRow;
		if (rowDescriptor) {
			// Get the layout indices for visible data.
			const columnIndices = this._rowLayoutManager.getLayoutIndexes(this.verticalScrollOffset, this.layoutHeight, OVERSCAN_FACTOR);
			await this._columnSchemaCache.update({
				columnIndices,
				invalidateCache: !!invalidateCache
			});
		}
	}

	/**
	 * Gets the custom width of a column.
	 * @param columnIndex The column index.
	 * @returns The custom width of the column; otherwise, undefined.
	 */
	override getCustomColumnWidth(columnIndex: number): number | undefined {
		// Subtrack 8px for margins.
		return columnIndex === 0 ? this.layoutWidth - 8 : undefined;
	}

	/**
	 * Select the column schema at the visual index provided.
	 * @param rowIndex The row index (visual positional) of the selected item.
	 */
	selectItem(rowIndex: number): void {
		// The row index is the visible row index, so we need to map it to the actual index.
		// For example, if the user has searched for a column name, the visible row index
		// may not match the actual index in the dataset.
		const index = this._rowLayoutManager.mapPositionToIndex(rowIndex);
		if (index === undefined) {
			return;
		}
		// Get the column schema using the actual index in the dataset
		const columnSchema = this._columnSchemaCache.getColumnSchema(index);
		if (!columnSchema) {
			return;
		}

		this._onDidSelectColumnEmitter.fire(columnSchema);
	}

	/**
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index from the original dataset.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// Column index must be 0.
		if (columnIndex !== 0) {
			return undefined;
		}

		// Get the column schema for the data at this row index.
		const columnSchema = this._columnSchemaCache.getColumnSchema(rowIndex);
		if (!columnSchema) {
			return undefined;
		}

		// Get the visual index position for the data at this row index
		const visualPosition = this._rowLayoutManager.mapIndexToPosition(rowIndex);

		// Return the cell.
		return (
			<ColumnSelectorCell
				columnIndex={visualPosition ?? -1}
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
			await this.updateLayoutEntries();
			// Always invalidate the cache when search text changes,
			// so the layout manager and cache are in sync.
			await this.fetchData(true);

			// select the first available row after fetching so that users can hit "enter"
			// to make an immediate confirmation on what they were searching for
			if (this.rows > 0) {
				this.showCursor();
				this.setCursorRow(0);
			}

			// Force a re-render when the search changes
			this.fireOnDidUpdateEvent();
		}
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	* Updates the layout entries to render.
	* @param backendState The backend state, if known; otherwise, undefined.
	*/
	private async updateLayoutEntries(backendState?: BackendState) {
		if (!this._searchText) {
			// Get the backend state, if it was not supplied.
			if (!backendState) {
				backendState = await this._dataExplorerClientInstance.getBackendState();
			}
			this._rowLayoutManager.setEntries(backendState.table_shape.num_columns);
		} else {
			const searchResults = await this._dataExplorerClientInstance.searchSchema2({
				searchText: this._searchText,
			});
			this._rowLayoutManager.setEntries(searchResults.matches.length, undefined, searchResults.matches);
		}
	}

	//#endregion Private Methods

	/**
	 * Moves the cursor down.
	 * Override to work with visual positions instead of data indices.
	 */
	override moveCursorDown() {
		// Calculate the next visual position
		const nextRowIndex = this.cursorRowIndex + 1;
		// Check if we're at the last row
		if (nextRowIndex >= this.rows) {
			return;
		}
		// Set the cursor row index to the next visual position
		this.setCursorRow(nextRowIndex);
		// Scroll to the cursor
		this.scrollToCursor();
	}

	/**
	 * Moves the cursor up.
	 * Override to work with visual positions instead of data indices.
	 */
	override moveCursorUp() {
		// Calculate the previous visual position
		const prevRowIndex = this.cursorRowIndex - 1;
		// Check if we're at the first row
		if (prevRowIndex < 0) {
			return;
		}
		// Set the cursor row index to the previous visual position
		this.setCursorRow(prevRowIndex);
		// Scroll to the cursor
		this.scrollToCursor();
	}
}
