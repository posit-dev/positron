/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { Emitter } from 'vs/base/common/event';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { DataGridInstance } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';
import { ColumnSummaryCell } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSummaryCell';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { ColumnDisplayType, ColumnSummaryStats } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

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
	 * Gets the expanded columns set.
	 */
	private readonly _expandedColumns = new Set<number>();

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
	 * @param _dataExplorerClientInstance The DataExplorerClientInstance.
	 * @param _dataExplorerCache The DataExplorerCache.
	 */
	constructor(
		private readonly _configurationService: IConfigurationService,
		private readonly _hoverService: IHoverService,
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance,
		private readonly _dataExplorerCache: DataExplorerCache
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

		// Add the onDidUpdateCache event handler.
		this._register(this._dataExplorerCache.onDidUpdateCache(() => {
			this._onDidUpdateEmitter.fire();
			this._dataExplorerCache.cacheColumnSummaryStats([...this._expandedColumns]).then(
				// Asynchronously update the summary stats for expanded columns then re-render
				() => this._onDidUpdateEmitter.fire()
			);
		}));

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			await this.setScreenPosition(0, 0);
			this._expandedColumns.clear();
			await this.fetchData();
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
		return this._dataExplorerCache.columns;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Fetches data.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData() {
		await this._dataExplorerCache.updateCache({
			firstColumnIndex: this.firstRowIndex,
			visibleColumns: this.screenRows
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
		const columnSchema = this._dataExplorerCache.getColumnSchema(rowIndex);
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
		const columnSchema = this._dataExplorerCache.getColumnSchema(rowIndex);
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

	getColumnNullCount(columnIndex: number): number | undefined {
		return this._dataExplorerCache.getColumnNullCount(columnIndex);
	}

	getColumnNullPercent(columnIndex: number): number | undefined {
		const nullCount = this._dataExplorerCache.getColumnNullCount(columnIndex);
		if (this._dataExplorerCache.rows === 0) {
			// #2770: do not divide by zero
			return 0;
		} else {
			return nullCount === undefined ? undefined : Math.floor(
				nullCount * 100 / this._dataExplorerCache.rows);
		}
	}

	getColumnSummaryStats(columnIndex: number): ColumnSummaryStats | undefined {
		return this._dataExplorerCache.getColumnSummaryStats(columnIndex);
	}

	getSupportedFeatures() {
		return this._dataExplorerClientInstance.getSupportedFeatures();
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
	 * Returns a value which indicates whether a column is expanded.
	 * @param columnIndex The columm index.
	 * @returns A value which indicates whether the column is expanded.
	 */
	isColumnExpanded(columnIndex: number) {
		return this._expandedColumns.has(columnIndex);
	}

	/**
	 * Toggles expand column.
	 * @param columnIndex The columm index.
	 */
	toggleExpandColumn(columnIndex: number) {
		// Toggle expand column.
		if (this._expandedColumns.has(columnIndex)) {
			this._expandedColumns.delete(columnIndex);
		} else {
			this._expandedColumns.add(columnIndex);
			this.scrollToRow(columnIndex);

			this._dataExplorerCache.cacheColumnSummaryStats([columnIndex]).then(() => {
				// Re-render when the column summary stats return
				this._onDidUpdateEmitter.fire();
			});
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	//#endregion Private Methods
}
