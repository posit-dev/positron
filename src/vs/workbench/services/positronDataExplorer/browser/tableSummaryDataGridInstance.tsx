/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { Emitter } from '../../../../base/common/event.js';
import { TableSummaryCache } from '../common/tableSummaryCache.js';
import { ColumnSummaryCell } from './components/columnSummaryCell.js';
import { COLUMN_PROFILE_DATE_LINE_COUNT } from './components/columnProfileDate.js';
import { COLUMN_PROFILE_NUMBER_LINE_COUNT } from './components/columnProfileNumber.js';
import { COLUMN_PROFILE_OBJECT_LINE_COUNT } from './components/columnProfileObject.js';
import { COLUMN_PROFILE_STRING_LINE_COUNT } from './components/columnProfileString.js';
import { COLUMN_PROFILE_BOOLEAN_LINE_COUNT } from './components/columnProfileBoolean.js';
import { PositronReactServices } from '../../../../base/browser/positronReactServices.js';
import { COLUMN_PROFILE_DATE_TIME_LINE_COUNT } from './components/columnProfileDatetime.js';
import { DataGridInstance } from '../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { BackendState, ColumnDisplayType, ColumnProfileType, SearchSchemaSortOrder, SupportStatus } from '../../languageRuntime/common/positronDataExplorerComm.js';

/**
 * Constants.
 */
const SUMMARY_HEIGHT = 34;
const PROFILE_LINE_HEIGHT = 20;
const OVERSCAN_FACTOR = 3

/**
 * TableSummaryDataGridInstance class.
 */
export class TableSummaryDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the Positron React services.
	 */
	private readonly _services = PositronReactServices.services;

	/**
	 * The current column name search filter text.
	 */
	private _searchText = '';

	/**
	 * The current sort option for the summary rows
	 *
	 * If no sort option is set, the summary rows
	 * are displayed in their original order.
	 */
	private _sortOption: SearchSchemaSortOrder = SearchSchemaSortOrder.Original;

	/**
	 * The onDidSelectColumn event emitter.
	 */
	private readonly _onDidSelectColumnEmitter = this._register(new Emitter<number>);

	public readonly _hoverManager: PositronActionBarHoverManager;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 * @param _tableSummaryCache The table summary cache.
	 */
	constructor(
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
			columnPinning: false,
			// We need to enable row pinning so the layout height is properly calculated
			// when there are pinned rows in the TableSummaryDataGridInstance.
			// In TableSummaryDataGridInstance, pinned rows are actually pinned columns
			// There is no UI in the table summary panel to pin/unpin rows. Instead, rows
			// are pinned/unpinned programatically when a user pin/unpins a column in the main
			// data grid.
			rowPinning: true,
			maximumPinnedRows: 10,
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
		this._columnLayoutManager.setEntries(1);

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Update the layout entries.
			await this.updateLayoutEntries();

			// Perform a soft reset.
			this.softReset();

			// Fetch data.
			await this.fetchData(true);
		}));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			// Update the layout entries.
			await this.updateLayoutEntries();

			// Refresh the column profiles because they rely on the data.
			await this._tableSummaryCache.refreshColumnProfiles();

			// Fetch data.
			await this.fetchData(true);
		}));

		// Add the onDidUpdateBackendState event handler.
		this._register(this._dataExplorerClientInstance.onDidUpdateBackendState(async state => {
			// Always update layout entries and invalidate cache when backend state changes
			// Backend state changes represent changes to the underlying data (like row filters)
			// so column profiles need to be recalculated regardless of search/sort state
			await this.updateLayoutEntries(state);
			await this.fetchData(true);
		}));

		// Add the table summary cache onDidUpdate event handler.
		this._register(this._tableSummaryCache.onDidUpdate(() =>
			// Fire the onDidUpdate event.
			this.fireOnDidUpdateEvent()
		));

		// Create the hover manager.
		this._hoverManager = this._register(new PositronActionBarHoverManager(
			true,
			this._services.configurationService,
			this._services.hoverService
		));

		// Show tooltip hovers right away.
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
	 * Gets the search text.
	 */
	get searchText() {
		return this._searchText;
	}

	/**
	 * Gets the sort option.
	 */
	get sortOption() {
		return this._sortOption;
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

			// Only update the cache if layout indices array is not empty.
			// This avoids accidentally clearing the cache during UI state
			// transitions (like resizing) which cause layout indices to be
			// temporarily empty.
			if (columnIndices.length > 0 || invalidateCache) {
				await this._tableSummaryCache.update({
					invalidateCache: !!invalidateCache,
					columnIndices,
				});
			}
		}
	}

	/**
	 * Gets the custom width of a column.
	 * @param columnIndex The column index.
	 * @returns The custom width of the column; otherwise, undefined.
	 */
	override getCustomColumnWidth(columnIndex: number): number | undefined {
		return columnIndex === 0 ? this.layoutWidth : undefined;
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
		return this._services.configurationService;
	}

	/**
	 * Gets the hover manager.
	 */
	override get hoverManager() {
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
	 * Determines whether summary stats is supported.
	 * @returns true, if summary stats is supported; otherwise, false.
	 */
	isSummaryStatsSupported(): boolean {
		// Check if summary stats feature is enabled globally
		const columnProfilesFeatures = this.getSupportedFeatures().get_column_profiles;
		const summaryStatsSupportStatus = columnProfilesFeatures.supported_types.find(status =>
			status.profile_type === ColumnProfileType.SummaryStats
		);

		// If the summary status support status is undefined, return false.
		if (!summaryStatsSupportStatus) {
			return false;
		}

		// Return the summary stats support status.
		return summaryStatsSupportStatus.support_status === SupportStatus.Supported;
	}

	/**
	 * Determines whether the specified column index can be expanded or collapsed.
	 * @param columnIndex The columm index.
	 * @returns true if the column can be expanded or collapsed; otherwise, false.
	 */
	canToggleColumnExpansion(columnIndex: number): boolean {
		// Get the column schema. If it hasn't been loaded yet, return false.
		const columnSchema = this._tableSummaryCache.getColumnSchema(columnIndex);
		if (!columnSchema) {
			return false;
		}

		let summaryStatsSupported;
		switch (columnSchema.type_display) {
			case ColumnDisplayType.Number:
			case ColumnDisplayType.Floating:
			case ColumnDisplayType.Integer:
			case ColumnDisplayType.Decimal:
			case ColumnDisplayType.Boolean:
			case ColumnDisplayType.String:
			case ColumnDisplayType.Date:
			case ColumnDisplayType.Datetime:
			case ColumnDisplayType.Object:
				summaryStatsSupported = this.isSummaryStatsSupported();
				break;
			case ColumnDisplayType.Time:
			case ColumnDisplayType.Interval:
			case ColumnDisplayType.Array:
			case ColumnDisplayType.Struct:
			case ColumnDisplayType.Unknown:
				summaryStatsSupported = false;
				break;

			// This shouldn't ever happen.
			default:
				summaryStatsSupported = false;
				break;
		}

		return summaryStatsSupported;
	}

	/**
	 * Toggles the expanded state of the specified column index.
	 * @param columnIndex The columm index.
	 */
	async toggleExpandColumn(columnIndex: number) {
		if (this._tableSummaryCache.isColumnExpanded(columnIndex)) {
			this._rowLayoutManager.clearSizeOverride(columnIndex);
		} else {
			this._rowLayoutManager.setSizeOverride(columnIndex, this.expandedRowHeight(columnIndex));
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
		const rows = this._tableSummaryCache.rows;

		// If the table has no rows, the null percent is 0% (0 nulls out of 0 total).
		if (!rows) {
			return 0;
		}

		// Get the null count. If it hasn't been loaded yet, return undefined.
		const nullCount = this._tableSummaryCache.getColumnProfile(columnIndex)?.null_count;
		if (nullCount === undefined) {
			return undefined;
		}

		// Calculate and return the column null percent.
		return (nullCount * 100) / rows;
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

	/**
	 * Updates the pinned rows in the summary panel.
	 *
	 * Note: The summary panel pins column indices as rows.
	 * This is because the summary panel is a single column data grid
	 * where each row represents a column from the main data grid.
	 *
	 * @param pinnedColumnIndices An array of column indices to pin as rows in the summary panel.
	 */
	async updatePinnedRows(pinnedColumnIndices: number[]): Promise<void> {

		// Temporarily reset the layout to allow pinning any column index
		// This is needed for the case where we have an active search/sort
		// because the layout manager checks against the current entry map
		// of filtered columns, but we want to be able to pin columns that
		// are not in the current entry map.
		const state = await this._dataExplorerClientInstance.getBackendState();
		this._rowLayoutManager.setEntries(state.table_shape.num_columns);

		// Now update the pinned indexes in the row layout manager.
		this._rowLayoutManager.setPinnedIndexes(pinnedColumnIndices);

		if (this.hasNoSearchOrSort()) {
			this.fetchData(false);
		} else {
			// If there's an active search or sort, we need to refresh the layout entries
			// to ensure the new pinned columns are included in the combined entry map
			await this.updateLayoutEntries();
			// Invalidate the cache when pinned columns change with active search/sort
			await this.fetchData(true);
		}

		// Force a re-render when the pinned columns change
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Sets the column name search filter.
	 * @param searchText The search text used to filter column names (case insensitive).
	 */
	async setSearchText(searchText: string): Promise<void> {
		if (this._searchText !== searchText) {
			this._searchText = searchText;
			await this.updateLayoutEntries();
			// invalidate the cache when the search and sort is removed
			await this.fetchData(this.hasNoSearchOrSort());
			// Force a re-render when the search or sort options change
			this.fireOnDidUpdateEvent();
		}
	}

	/**
	 * Sets the sort option for the summary rows.
	 * @param sortOption The sort option used to order the rows.
	 */
	async setSortOption(sortOption: SearchSchemaSortOrder): Promise<void> {
		if (this._sortOption !== sortOption) {
			this._sortOption = sortOption;
			await this.updateLayoutEntries();
			// invalidate the cache when the search and sort is removed
			await this.fetchData(this.hasNoSearchOrSort());
			// Force a re-render when the search or sort options change
			this.fireOnDidUpdateEvent();
		}
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Helper function to determine if there is a search or sort option applied.
	 * Used to determine when the cache should be invalidated.
	 * @returns A value which indicates whether there is a search or sort option applied.
	 */
	private hasNoSearchOrSort(): boolean {
		return this._searchText === '' && this._sortOption === SearchSchemaSortOrder.Original;
	}

	/**
	 * Updates the layout entries to render.
	 * @param state The backend state, if known; otherwise, undefined.
	 */
	private async updateLayoutEntries(state?: BackendState) {
		if (this.hasNoSearchOrSort()) {
			// When there is no search or sort option, we need to tell the layout manager
			// to use the original table shape and render all the data
			if (!state) {
				state = await this._dataExplorerClientInstance.getBackendState();
			}
			this._rowLayoutManager.setEntries(state.table_shape.num_columns);
		} else {
			// Get current pinned indexes from the layout manager BEFORE doing anything else
			// This is important because setEntries() can clear the pinned indexes if they're not
			// in the new entry map
			const pinnedColumns = this._rowLayoutManager.pinnedIndexes;

			// When there is a search or sort option, we need to tell the layout manager
			// to use the filtered table shape and render both pinned columns and search results.
			const searchResults = await this._dataExplorerClientInstance.searchSchema2({
				searchText: this._searchText,
				sortOption: this._sortOption,
			});

			// Create a combined entry map that includes both pinned columns and search results
			// Pinned columns should appear first, followed by search results that aren't already pinned
			const pinnedSet = new Set(pinnedColumns);
			const combinedEntries: number[] = [
				...pinnedColumns,
				...searchResults.matches.filter(matchedColumn => !pinnedSet.has(matchedColumn))
			];

			this._rowLayoutManager.setEntries(combinedEntries.length, undefined, combinedEntries);
		}

		// Ensures the user is not scrolled off the screen
		// For example: this can happen if the user is scrolled to the end of the table,
		// adds a search filter, which results in a single entry. We need to reset the
		// scroll position back to the top so the user can see the data.
		if (!this.firstRow) {
			this._verticalScrollOffset = 0;
		} else if (this._verticalScrollOffset > this.maximumVerticalScrollOffset) {
			this._verticalScrollOffset = this.maximumVerticalScrollOffset;
		}
	}

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
			// Number (including all numeric subtypes).
			case ColumnDisplayType.Number:
			case ColumnDisplayType.Floating:
			case ColumnDisplayType.Integer:
			case ColumnDisplayType.Decimal:
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
