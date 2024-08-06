/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { Emitter } from 'vs/base/common/event';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { DataGridInstance } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { TableSummaryCache } from 'vs/workbench/services/positronDataExplorer/common/tableSummaryCache';
import { ColumnDisplayType } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ColumnSummaryCell } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSummaryCell';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

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
			defaultColumnWidth: 200,
			defaultRowHeight: SUMMARY_HEIGHT,
			columnResize: false,
			rowResize: false,
			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarWidth: 14,
			useEditorFont: false,
			automaticLayout: true,
			cellBorders: false,
			internalCursor: false,
			selection: false
		});

		// Add the data explorer client instance onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Update the cache with invalidation.
			await this._tableSummaryCache.update({
				invalidateCache: true,
				firstColumnIndex: this.firstColumnIndex,
				screenColumns: this.screenRows
			});
		}));

		// Add the data explorer client instance onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			// Refresh the column profiles because they rely on the data.
			await this._tableSummaryCache.refreshColumnProfiles();
		}));

		// Add the table summary cache onDidUpdate event handler.
		this._register(this._tableSummaryCache.onDidUpdate(() => {
			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
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
		return this._tableSummaryCache.columns;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Fetches data.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData() {
		await this._tableSummaryCache.update({
			invalidateCache: false,
			firstColumnIndex: this.firstRowIndex,
			screenColumns: this.screenRows
		});
	}

	/**
	 * Gets the the width of a column.
	 * @param columnIndex The column index.
	 */
	override getColumnWidth(columnIndex: number): number {
		return this.layoutWidth;
	}

	/**
	 * Gets the the height of a row.
	 * @param rowIndex The row index.
	 */
	override getRowHeight(rowIndex: number): number {
		// If the column isn't expanded, return the summary height.
		if (!this.isColumnExpanded(rowIndex)) {
			return SUMMARY_HEIGHT;
		}

		// Get the column schema. If it hasn't been loaded yet, return the summary height.
		const columnSchema = this._tableSummaryCache.getColumnSchema(rowIndex);
		if (!columnSchema) {
			return SUMMARY_HEIGHT;
		}

		/**
		 * Returns the row height with the specified number of lines.
		 * @param profileLines
		 * @returns
		 */
		const rowHeight = (profileLines: number) => {
			if (profileLines === 0) {
				return SUMMARY_HEIGHT;
			} else {
				return SUMMARY_HEIGHT + (profileLines * PROFILE_LINE_HEIGHT) + 10;
			}
		};

		// Return the row height.
		switch (columnSchema.type_display) {
			case ColumnDisplayType.Number:
				return rowHeight(6);

			case ColumnDisplayType.Boolean:
				return rowHeight(3);

			case ColumnDisplayType.String:
				return rowHeight(3);

			case ColumnDisplayType.Date:
				return rowHeight(7);

			case ColumnDisplayType.Datetime:
				return rowHeight(7);

			case ColumnDisplayType.Time:
				return rowHeight(7);

			case ColumnDisplayType.Array:
				return rowHeight(2);

			case ColumnDisplayType.Struct:
				return rowHeight(2);

			case ColumnDisplayType.Unknown:
				return rowHeight(2);

			// This shouldn't ever happen.
			default:
				return rowHeight(0);
		}
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
				hoverService={this._hoverService}
				instance={this}
				columnSchema={columnSchema}
				columnIndex={rowIndex}
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
		return this._tableSummaryCache.toggleExpandColumn(columnIndex);
	}

	/**
	 * Gets the column null count for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column null count for the specified column index
	 */
	getColumnNullCount(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.null_count;
	}

	/**
	 * Gets the column null percent for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column null percent for the specified column index
	 */
	getColumnNullPercent(columnIndex: number) {
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
	 * Gets the column summary stats for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column summary stats for the specified column index
	 */
	getColumnSummaryStats(columnIndex: number) {
		return this._tableSummaryCache.getColumnProfile(columnIndex)?.summary_stats;
	}

	//#endregion Private Methods
}
