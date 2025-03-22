/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { Emitter } from '../../../../base/common/event.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { DataGridInstance } from '../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { TableSummaryCache } from '../common/tableSummaryCache.js';
import { ColumnSummaryCell } from './components/columnSummaryCell.js';
import { BackendState, ColumnDisplayType } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { COLUMN_PROFILE_DATE_LINE_COUNT } from './components/columnProfileDate.js';
import { COLUMN_PROFILE_NUMBER_LINE_COUNT } from './components/columnProfileNumber.js';
import { COLUMN_PROFILE_OBJECT_LINE_COUNT } from './components/columnProfileObject.js';
import { COLUMN_PROFILE_STRING_LINE_COUNT } from './components/columnProfileString.js';
import { COLUMN_PROFILE_BOOLEAN_LINE_COUNT } from './components/columnProfileBoolean.js';
import { COLUMN_PROFILE_DATE_TIME_LINE_COUNT } from './components/columnProfileDatetime.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';

/**
 * Constants.
 */
const SUMMARY_HEIGHT = 34;
const PROFILE_LINE_HEIGHT = 20;

/**
 * TableSummaryDataGridInstance class.
 */
export class TableSummaryDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * The onDidSelectColumn event emitter.
	 */
	private readonly _onDidSelectColumnEmitter = this._register(new Emitter<number>);

	public readonly _hoverManager: PositronActionBarHoverManager;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _configurationService The configuration service.
	 * @param _hoverService The hover service.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 * @param _tableSummaryCache The table summary cache.
	 */
	constructor(
		private readonly _configurationService: IConfigurationService,
		private readonly _hoverService: IHoverService,
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance,
		private readonly _tableSummaryCache: TableSummaryCache
	) {
		// Call the base class's constructor.
		super({
			columnHeaders: false,
			rowHeaders: false,
			defaultColumnWidth: 0,
			defaultRowHeight: SUMMARY_HEIGHT,
			columnResize: false,
			rowResize: false,
			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarThickness: 14,
			scrollbarOverscroll: 0,
			useEditorFont: false,
			automaticLayout: true,
			cellBorders: false,
			internalCursor: false,
			selection: false
		});



		// Set the column layout entries. There is always one column.
		this._columnLayoutManager.setLayoutEntries(1);

		/**
		 * Updates the layout entries.
		 * @param state The backend state, if known; otherwise, undefined.
		 */
		const updateLayoutEntries = async (state?: BackendState) => {
			// Get the backend state, if was not provided.
			if (!state) {
				state = await this._dataExplorerClientInstance.getBackendState();
			}

			// Set the layout entries.
			this._rowLayoutManager.setLayoutEntries(state.table_shape.num_columns);

			// Adjust the vertical scroll offset, if needed.
			if (!this.firstRow) {
				this._verticalScrollOffset = 0;
			} else if (this._verticalScrollOffset > this.maximumVerticalScrollOffset) {
				this._verticalScrollOffset = this.maximumVerticalScrollOffset;
			}
		};

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Update the layout entries.
			await updateLayoutEntries();

			// Perform a soft reset.
			this.softReset();

			// Fetch data.
			await this.fetchData(true);
		}));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			// Update the layout entries.
			await updateLayoutEntries();

			// Refresh the column profiles because they rely on the data.
			await this._tableSummaryCache.refreshColumnProfiles();

			// Fetch data.
			await this.fetchData(true);
		}));

		// Add the onDidUpdateBackendState event handler.
		this._register(this._dataExplorerClientInstance.onDidUpdateBackendState(async state => {
			// Update the layout entries.
			await updateLayoutEntries(state);

			// Invalidate cache and fetch data, profiles
			await this.fetchData(/* invalidateCache=*/true);
		}));

		// Add the table summary cache onDidUpdate event handler.
		this._register(this._tableSummaryCache.onDidUpdate(() =>
			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire()
		));

		// Create the hover manager.
		this._hoverManager = this._register(new PositronActionBarHoverManager(
			true,
			this._configurationService,
			this._hoverService
		));
		// Show tooltip hovers right away
		this._hoverManager.setCustomHoverDelay(0);
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
		return this._tableSummaryCache.columns;
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
	 * @param invalidateCache A value which indicates whether to invalidate the cache.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData(invalidateCache?: boolean) {
		const rowDescriptor = this.firstRow;
		if (rowDescriptor) {
			await this._tableSummaryCache.update({
				invalidateCache: !!invalidateCache,
				firstColumnIndex: rowDescriptor.rowIndex,
				screenColumns: this.screenRows
			});
		}
	}

	/**
	 * Gets the width of a column.
	 * @param columnIndex The column index.
	 */
	override getColumnWidth(columnIndex: number): number {
		return this.layoutWidth;
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

		// Get the column schema.
		const columnSchema = this._tableSummaryCache.getColumnSchema(rowIndex);
		if (!columnSchema) {
			return undefined;
		}

		// Return the ColumnSummaryCell.
		return (
			<ColumnSummaryCell
				columnIndex={rowIndex}
				columnSchema={columnSchema}
				instance={this}
				onDoubleClick={() => this._onDidSelectColumnEmitter.fire(rowIndex)}
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

	//#region Public Properties

	/**
	 * Gets the configuration service.
	 */
	get configurationService() {
		return this._configurationService;
	}

	/**
	 * Gets the hover manager.
	 */
	get hoverManager() {
		return this._hoverManager;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Gets the supported features.
	 * @returns The supported features.
	 */
	getSupportedFeatures() {
		return this._dataExplorerClientInstance.getSupportedFeatures();
	}

	/**
	 * Returns a value which indicates whether the specified column index is expanded.
	 * @param columnIndex The columm index.
	 * @returns A value which indicates whether the specified column index is expanded.
	 */
	isColumnExpanded(columnIndex: number) {
		return this._tableSummaryCache.isColumnExpanded(columnIndex);
	}

	/**
	 * Toggles the expanded state of the specified column index.
	 * @param columnIndex The columm index.
	 */
	async toggleExpandColumn(columnIndex: number) {
		if (this._tableSummaryCache.isColumnExpanded(columnIndex)) {
			this._rowLayoutManager.clearLayoutOverride(columnIndex);
		} else {
			this._rowLayoutManager.setLayoutOverride(columnIndex, this.expandedRowHeight(columnIndex));
		}
		return this._tableSummaryCache.toggleExpandColumn(columnIndex);
	}

	/**
	 * Gets the column profile null count for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile null count for the specified column index
	 */
	getColumnProfileNullCount(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.null_count;
	}

	/**
	 * Gets the column profile null percent for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile null percent for the specified column index
	 */
	getColumnProfileNullPercent(columnIndex: number) {
		// If the table has no rows, it's meaningless to calculate the column null percent. Return
		// undefined in this case.
		const rows = this._tableSummaryCache.rows;
		if (!rows) {
			return undefined;
		}

		// Get the null count. If it hasn't been loaded yet, return undefined.
		const nullCount = this._tableSummaryCache.getColumnProfile(columnIndex)?.null_count;
		if (nullCount === undefined) {
			return undefined;
		}

		// Calculate and return the column null percent.
		return Math.floor(nullCount * 100 / rows);
	}

	/**
	 * Gets the column profile summary stats for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile summary stats for the specified column index
	 */
	getColumnProfileSummaryStats(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.summary_stats;
	}

	/**
	 * Gets the column profile small histogram for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile small histogram for the specified column index
	 */
	getColumnProfileSmallHistogram(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.small_histogram;
	}

	/**
	 * Gets the column profile large histogram for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile large histogram for the specified column index
	 */
	getColumnProfileLargeHistogram(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.large_histogram;
	}

	/**
	 * Gets the column profile small frequency table for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile small frequency table for the specified column index
	 */
	getColumnProfileSmallFrequencyTable(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.small_frequency_table;
	}

	/**
	 * Gets the column profile large frequency table for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile large frequency table for the specified column index
	 */
	getColumnProfileLargeFrequencyTable(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.large_frequency_table;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Gets an expanded row height.
	 * @param rowIndex The row index of the expanded row height to return.
	 * @returns The expanded row height.
	 */
	private expandedRowHeight(rowIndex: number): number {
		// Get the column schema. If it hasn't been loaded yet, return the summary height.
		const columnSchema = this._tableSummaryCache.getColumnSchema(rowIndex);
		if (!columnSchema) {
			return SUMMARY_HEIGHT;
		}

		/**
		 * Calculates the row height.
		 * @param displaySparkline A value which indicates whether the sparkline will be displayed.
		 * @param profileLines The number of profile lines.
		 * @returns The row height.
		 */
		const rowHeight = (displaySparkline: boolean, profileLines: number) => {
			// Every row displays the column summary.
			let rowHeight = SUMMARY_HEIGHT;

			// Account for the sparkline.
			if (displaySparkline) {
				rowHeight += 50 + 10;
			}

			// Account for the profile lines.
			if (profileLines) {
				rowHeight += (profileLines * PROFILE_LINE_HEIGHT) + 12;
			}

			// Return the row height.
			return rowHeight;
		};

		// Return the row height.
		switch (columnSchema.type_display) {
			// Number.
			case ColumnDisplayType.Number:
				return rowHeight(true, COLUMN_PROFILE_NUMBER_LINE_COUNT);

			// Boolean.
			case ColumnDisplayType.Boolean:
				return rowHeight(true, COLUMN_PROFILE_BOOLEAN_LINE_COUNT);

			// String.
			case ColumnDisplayType.String: {
				return rowHeight(true, COLUMN_PROFILE_STRING_LINE_COUNT);
			}

			// Date.
			case ColumnDisplayType.Date: {
				return rowHeight(false, COLUMN_PROFILE_DATE_LINE_COUNT);
			}

			// Datetime.
			case ColumnDisplayType.Datetime: {
				return rowHeight(false, COLUMN_PROFILE_DATE_TIME_LINE_COUNT);
			}

			// Object.
			case ColumnDisplayType.Object: {
				return rowHeight(true, COLUMN_PROFILE_OBJECT_LINE_COUNT);
			}

			// Column display types that do not render a profile.
			case ColumnDisplayType.Time:
			case ColumnDisplayType.Interval:
			case ColumnDisplayType.Array:
			case ColumnDisplayType.Struct:
			case ColumnDisplayType.Unknown: {
				return rowHeight(false, 0);
			}

			// This shouldn't ever happen.
			default: {
				return rowHeight(false, 0);
			}
		}
	}

	//#endregion Private Methods
}
