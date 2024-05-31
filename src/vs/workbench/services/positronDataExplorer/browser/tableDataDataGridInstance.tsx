/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IColumnSortKey } from 'vs/workbench/browser/positronDataGrid/interfaces/columnSortKey';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';
import { TableDataCell } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataCell';
import { showCustomContextMenu } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenu';
import { TableDataRowHeader } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataRowHeader';
import { CustomContextMenuItem } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenuItem';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { ColumnSortKeyDescriptor, DataGridInstance } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { BackendState, ColumnSchema, RowFilter } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { CustomContextMenuSeparator } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenuSeparator';
import { PositronDataExplorerCommandId } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerActions';

/**
 * Localized strings.
 */
const addFilterTitle = localize('positron.addFilter', "Add Filter");

/**
 * TableDataDataGridInstance class.
 */
export class TableDataDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * The onAddFilter event emitter.
	 */
	private readonly _onAddFilterEmitter = this._register(new Emitter<ColumnSchema>);

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _commandService The command service.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _dataExplorerClientInstance The DataExplorerClientInstance.
	 * @param _dataExplorerCache The DataExplorerCache.
	 */
	constructor(
		private readonly _commandService: ICommandService,
		private readonly _keybindingService: IKeybindingService,
		private readonly _layoutService: ILayoutService,
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance,
		private readonly _dataExplorerCache: DataExplorerCache
	) {
		// Call the base class's constructor.
		super({
			columnHeaders: true,
			columnHeadersHeight: 34,
			rowHeaders: true,
			rowHeadersWidth: 55,
			rowHeadersResize: true,
			defaultColumnWidth: 200,
			defaultRowHeight: 24,
			columnResize: true,
			minimumColumnWidth: 100,
			rowResize: false,
			horizontalScrollbar: true,
			verticalScrollbar: true,
			scrollbarWidth: 14,
			useEditorFont: true,
			automaticLayout: true,
			cellBorders: true,
			internalCursor: true,
			cursorOffset: 0.5,
		});

		// Add the onDidUpdateCache event handler.
		this._register(this._dataExplorerCache.onDidUpdateCache(() =>
			this._onDidUpdateEmitter.fire()
		));

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async e => {
			this._dataExplorerCache.invalidateDataCache();
			this.softReset();
			await this.fetchData();
		}));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			this._dataExplorerCache.invalidateDataCache();
			await this.fetchData();
		}));

		// Add the onDidUpdateBackendState event handler.
		this._register(this._dataExplorerClientInstance.onDidUpdateBackendState(
			async (state: BackendState) => {
				// Clear column sort keys.
				this._columnSortKeys.clear();
				state.sort_keys.forEach((key, sortIndex) => {
					this._columnSortKeys.set(key.column_index,
						new ColumnSortKeyDescriptor(sortIndex, key.column_index, key.ascending)
					);
				});
				this._onDidUpdateEmitter.fire();
			}
		));
	}

	//#endregion Constructor

	//#region DataGridInstance Properties

	/**
	 * Gets the number of columns.
	 */
	get columns() {
		return this._dataExplorerCache.columns;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._dataExplorerCache.rows;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	override async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
		// Set the sort columns.
		await this._dataExplorerClientInstance.setSortColumns(columnSorts.map(columnSort => (
			{
				column_index: columnSort.columnIndex,
				ascending: columnSort.ascending
			}
		)));

		// Clear the data cache and fetch new data.
		this._dataExplorerCache.invalidateDataCache();
		await this.fetchData();
	}

	/**
	 * Fetches data.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData() {
		// Update the cache.
		await this._dataExplorerCache.updateCache({
			firstColumnIndex: this.firstColumnIndex,
			visibleColumns: this.screenColumns,
			firstRowIndex: this.firstRowIndex,
			visibleRows: this.screenRows
		});
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	override column(columnIndex: number) {
		// Get the column schema.
		const columnSchema = this._dataExplorerCache.getColumnSchema(columnIndex);
		if (!columnSchema) {
			return undefined;
		}

		// Return the column.
		return new PositronDataExplorerColumn(columnSchema);
	}

	/**
	 * Gets a row header.
	 * @param rowIndex The row index.
	 * @returns The row label, or, undefined.
	 */
	override rowHeader(rowIndex: number) {
		return (
			<TableDataRowHeader value={this._dataExplorerCache.getRowLabel(rowIndex)} />
		);
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// Get the column.
		const column = this.column(columnIndex);
		if (!column) {
			return undefined;
		}

		// Get the data cell.
		const dataCell = this._dataExplorerCache.getDataCell(columnIndex, rowIndex);
		if (!dataCell) {
			return undefined;
		}

		// Return the TableDataCell.
		return (
			<TableDataCell
				column={column}
				dataCell={dataCell}
			/>
		);
	}

	/**
	 * Shows the column context menu.
	 * @param anchor The anchor element.
	 * @param columnIndex The column index.
	 */
	override async showColumnContextMenu(anchor: HTMLElement, columnIndex: number): Promise<void> {
		/**
		 * Get the column sort key for the column.
		 */
		const columnSortKey = this.columnSortKey(columnIndex);

		// Show the custom context menu.
		await showCustomContextMenu(
			this._commandService,
			this._keybindingService,
			this._layoutService,
			anchor,
			'right',
			200,
			[
				new CustomContextMenuItem({
					checked: columnSortKey !== undefined && columnSortKey.ascending,
					icon: 'arrow-up',
					label: localize('positron.sortAscending', "Sort Ascending"),
					onSelected: async () => this.setColumnSortKey(
						columnIndex,
						true
					)
				}),
				new CustomContextMenuItem({
					checked: columnSortKey !== undefined && !columnSortKey.ascending,
					icon: 'arrow-down',
					label: localize('positron.sortDescending', "Sort Descending"),
					onSelected: async () => this.setColumnSortKey(
						columnIndex,
						false
					)
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					checked: false,
					icon: 'positron-clear-sorting',
					label: localize('positron.clearSorting', "Clear Sorting"),
					disabled: !columnSortKey,
					onSelected: async () =>
						this.removeColumnSortKey(columnIndex)
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					checked: false,
					icon: 'positron-add-filter',
					label: addFilterTitle,
					disabled: false,
					onSelected: () => {
						const columnSchema = this._dataExplorerCache.getColumnSchema(columnIndex);
						if (columnSchema) {
							this._onAddFilterEmitter.fire(columnSchema);
						}
					}
				}),
			]
		);
	}

	/**
	 * Shows the row context menu.
	 * @param anchor The anchor element.
	 * @param rowIndex The row index.
	 * @returns A Promise<void> that resolves when the context menu is complete.
	 */
	override async showRowContextMenu(anchor: HTMLElement, rowIndex: number): Promise<void> {
		// TODO.
	}

	/**
	 * Shows the cell context menu.
	 * @param anchor The anchor element.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 */
	override async showCellContextMenu(
		anchor: HTMLElement,
		columnIndex: number,
		rowIndex: number
	): Promise<void> {
		// Show the custom context menu.
		await showCustomContextMenu(
			this._commandService,
			this._keybindingService,
			this._layoutService,
			anchor,
			'left',
			200,
			[
				new CustomContextMenuItem({
					commandId: PositronDataExplorerCommandId.CopyAction,
					icon: 'copy',
					label: localize('positron.dataExplorer.copy', "Copy"),
					onSelected: () => console.log('Copy')
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					label: localize('positron.dataExplorer.selectColumn', "Select Column"),
					onSelected: () => this.selectColumn(columnIndex)
				}),
				new CustomContextMenuItem({
					label: localize('positron.dataExplorer.selectRow', "Select Row"),
					onSelected: () => this.selectRow(rowIndex)
				})
			]
		);
	}

	//#endregion DataGridInstance Methods

	//#region Public Events

	/**
	 * The onAddFilter event.
	 */
	readonly onAddFilter = this._onAddFilterEmitter.event;

	//#region Public Methods

	/**
	 * Sets row filters.
	 * @param rowFilters The row filters.
	 * @returns A Promise<FilterResult> that resolves when the operation is complete.
	 */
	async setRowFilters(filters: Array<RowFilter>): Promise<void> {
		// Set the row filters.
		await this._dataExplorerClientInstance.setRowFilters(filters);

		// Synchronize the backend state.
		await this._dataExplorerClientInstance.updateBackendState();

		// Reload the data grid.
		this._dataExplorerCache.invalidateDataCache();
		this.resetSelection();
		this.setFirstRow(0, true);
		this.setCursorRow(0);
	}

	//#endregion Public Methods
}
