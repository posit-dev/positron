/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
import { AnchorPoint } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { TableDataRowHeader } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataRowHeader';
import { CustomContextMenuItem } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenuItem';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { CustomContextMenuSeparator } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenuSeparator';
import { PositronDataExplorerCommandId } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerActions';
import { CustomContextMenuEntry, showCustomContextMenu } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenu';
import { BackendState, ColumnSchema, DataSelection, DataSelectionCellRange, DataSelectionIndices, DataSelectionKind, DataSelectionRange, DataSelectionSingleCell, ExportFormat, RowFilter, SupportStatus } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ClipboardCell, ClipboardCellRange, ClipboardColumnIndexes, ClipboardColumnRange, ClipboardData, ClipboardRowIndexes, ClipboardRowRange, ColumnSelectionState, ColumnSortKeyDescriptor, DataGridInstance, RowSelectionState } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { dataExplorerExperimentalFeatureEnabled } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerExperimentalConfig';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

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
		private readonly _dataExplorerCache: DataExplorerCache,
		private readonly _configurationService: IConfigurationService,
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
	 * @param columnIndex The column index.
	 * @param anchorElement The anchor element.
	 * @param anchorPoint The anchor point.
	 */
	override async showColumnContextMenu(
		columnIndex: number,
		anchorElement: HTMLElement,
		anchorPoint?: AnchorPoint
	): Promise<void> {
		/**
		 * Get the column sort key for the column.
		 */
		const columnSortKey = this.columnSortKey(columnIndex);

		const features = this._dataExplorerClientInstance.getSupportedFeatures();
		const copySupported = this.isFeatureEnabled(features.export_data_selection?.support_status);
		const sortSupported = this.isFeatureEnabled(features.set_sort_columns?.support_status);
		const filterSupported = this.isFeatureEnabled(features.set_row_filters?.support_status);

		// Build the entries.
		const entries: CustomContextMenuEntry[] = [];
		entries.push(new CustomContextMenuItem({
			commandId: PositronDataExplorerCommandId.CopyAction,
			checked: false,
			disabled: !copySupported,
			icon: 'copy',
			label: localize('positron.dataExplorer.copy', "Copy"),
			onSelected: () => console.log('Copy')
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-select-column',
			label: localize('positron.dataExplorer.selectColumn', "Select Column"),
			disabled: this.columnSelectionState(columnIndex) !== ColumnSelectionState.None,
			onSelected: () => this.selectColumn(columnIndex)
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: columnSortKey !== undefined && columnSortKey.ascending,
			icon: 'arrow-up',
			disabled: !sortSupported,
			label: localize('positron.sortAscending', "Sort Ascending"),
			onSelected: async () => this.setColumnSortKey(
				columnIndex,
				true
			)
		}));
		entries.push(new CustomContextMenuItem({
			checked: columnSortKey !== undefined && !columnSortKey.ascending,
			icon: 'arrow-down',
			disabled: !sortSupported,
			label: localize('positron.sortDescending', "Sort Descending"),
			onSelected: async () => this.setColumnSortKey(
				columnIndex,
				false
			)
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-clear-sorting',
			label: localize('positron.clearSorting', "Clear Sorting"),
			disabled: !columnSortKey,
			onSelected: async () =>
				this.removeColumnSortKey(columnIndex)
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-add-filter',
			label: addFilterTitle,
			disabled: !filterSupported,
			onSelected: () => {
				const columnSchema = this._dataExplorerCache.getColumnSchema(columnIndex);
				if (columnSchema) {
					this._onAddFilterEmitter.fire(columnSchema);
				}
			}
		}));

		// Show the context menu.
		await showCustomContextMenu({
			commandService: this._commandService,
			keybindingService: this._keybindingService,
			layoutService: this._layoutService,
			anchorElement,
			anchorPoint,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 200,
			entries
		});
	}

	/**
	 * Shows the row context menu.
	 * @param rowIndex The row index.
	 * @param anchorElement The anchor element.
	 * @param anchorPoint The anchor point.
	 * @returns A Promise<void> that resolves when the context menu is complete.
	 */
	override async showRowContextMenu(
		rowIndex: number,
		anchorElement: HTMLElement,
		anchorPoint: AnchorPoint
	): Promise<void> {
		const features = this._dataExplorerClientInstance.getSupportedFeatures();
		const copySupported = this.isFeatureEnabled(features.export_data_selection.support_status);

		// Build the entries.
		const entries: CustomContextMenuEntry[] = [];
		entries.push(new CustomContextMenuItem({
			commandId: PositronDataExplorerCommandId.CopyAction,
			checked: false,
			disabled: !copySupported,
			icon: 'copy',
			label: localize('positron.dataExplorer.copy', "Copy"),
			onSelected: () => console.log('Copy')
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-select-row',
			label: localize('positron.dataExplorer.selectRow', "Select Row"),
			disabled: this.rowSelectionState(rowIndex) !== RowSelectionState.None,
			onSelected: () => this.selectRow(rowIndex)
		}));

		// Show the context menu.
		await showCustomContextMenu({
			commandService: this._commandService,
			keybindingService: this._keybindingService,
			layoutService: this._layoutService,
			anchorElement,
			anchorPoint,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 200,
			entries
		});
	}

	/**
	 * Shows the cell context menu.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @param anchorElement The anchor element.
	 * @param anchorPoint The anchor point.
	 */
	override async showCellContextMenu(
		columnIndex: number,
		rowIndex: number,
		anchorElement: HTMLElement,
		anchorPoint: AnchorPoint
	): Promise<void> {
		/**
		 * Get the column sort key for the column.
		 */
		const columnSortKey = this.columnSortKey(columnIndex);

		const features = this._dataExplorerClientInstance.getSupportedFeatures();
		const copySupported = this.isFeatureEnabled(features.export_data_selection.support_status);
		const sortSupported = this.isFeatureEnabled(features.set_sort_columns.support_status);
		const filterSupported = this.isFeatureEnabled(features.set_row_filters.support_status);

		// Build the entries.
		const entries: CustomContextMenuEntry[] = [];
		entries.push(new CustomContextMenuItem({
			checked: false,
			disabled: !copySupported,
			commandId: PositronDataExplorerCommandId.CopyAction,
			icon: 'copy',
			label: localize('positron.dataExplorer.copy', "Copy"),
			onSelected: () => console.log('Copy')
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-select-column',
			label: localize('positron.dataExplorer.selectColumn', "Select Column"),
			disabled: this.columnSelectionState(columnIndex) !== ColumnSelectionState.None,
			onSelected: () => this.selectColumn(columnIndex)
		}));
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-select-row',
			label: localize('positron.dataExplorer.selectRow', "Select Row"),
			disabled: this.rowSelectionState(rowIndex) !== RowSelectionState.None,
			onSelected: () => this.selectRow(rowIndex)
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: columnSortKey !== undefined && columnSortKey.ascending,
			icon: 'arrow-up',
			disabled: !sortSupported,
			label: localize('positron.sortAscending', "Sort Ascending"),
			onSelected: async () => this.setColumnSortKey(
				columnIndex,
				true
			)
		}));
		entries.push(new CustomContextMenuItem({
			checked: columnSortKey !== undefined && !columnSortKey.ascending,
			icon: 'arrow-down',
			disabled: !sortSupported,
			label: localize('positron.sortDescending', "Sort Descending"),
			onSelected: async () => this.setColumnSortKey(
				columnIndex,
				false
			)
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-clear-sorting',
			label: localize('positron.clearSorting', "Clear Sorting"),
			disabled: !columnSortKey,
			onSelected: async () =>
				this.removeColumnSortKey(columnIndex)
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-add-filter',
			label: addFilterTitle,
			disabled: !filterSupported,
			onSelected: () => {
				const columnSchema = this._dataExplorerCache.getColumnSchema(columnIndex);
				if (columnSchema) {
					this._onAddFilterEmitter.fire(columnSchema);
				}
			}
		}));

		// Show the context menu.
		await showCustomContextMenu({
			commandService: this._commandService,
			keybindingService: this._keybindingService,
			layoutService: this._layoutService,
			anchorElement,
			anchorPoint,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 200,
			entries
		});
	}

	//#endregion DataGridInstance Methods

	//#region Public Events

	/**
	 * The onAddFilter event.
	 */
	readonly onAddFilter = this._onAddFilterEmitter.event;

	//#region Public Methods

	/**
	 * Copies the specified clipboard data.
	 * @param clipboardData The clipboard data to copy.
	 * @returns The clipboard data, or undefined, if it could not be copied.
	 */
	async copyClipboardData(clipboardData: ClipboardData): Promise<string | undefined> {
		// Construct the data selection based on the clipboard data.
		let dataSelection: DataSelection;
		if (clipboardData instanceof ClipboardCell) {
			const selection: DataSelectionSingleCell = {
				column_index: clipboardData.columnIndex,
				row_index: clipboardData.rowIndex,
			};
			dataSelection = {
				kind: DataSelectionKind.SingleCell,
				selection
			};
		} else if (clipboardData instanceof ClipboardCellRange) {
			const selection: DataSelectionCellRange = {
				first_column_index: clipboardData.firstColumnIndex,
				first_row_index: clipboardData.firstRowIndex,
				last_column_index: clipboardData.lastColumnIndex,
				last_row_index: clipboardData.lastRowIndex,
			};
			dataSelection = {
				kind: DataSelectionKind.CellRange,
				selection
			};
		} else if (clipboardData instanceof ClipboardColumnRange) {
			const selection: DataSelectionRange = {
				first_index: clipboardData.firstColumnIndex,
				last_index: clipboardData.lastColumnIndex
			};
			dataSelection = {
				kind: DataSelectionKind.ColumnRange,
				selection
			};
		} else if (clipboardData instanceof ClipboardColumnIndexes) {
			const selection: DataSelectionIndices = {
				indices: clipboardData.indexes
			};
			dataSelection = {
				kind: DataSelectionKind.ColumnIndices,
				selection
			};
		} else if (clipboardData instanceof ClipboardRowRange) {
			const selection: DataSelectionRange = {
				first_index: clipboardData.firstRowIndex,
				last_index: clipboardData.lastRowIndex
			};
			dataSelection = {
				kind: DataSelectionKind.RowRange,
				selection
			};
		} else if (clipboardData instanceof ClipboardRowIndexes) {
			const selection: DataSelectionIndices = {
				indices: clipboardData.indexes
			};
			dataSelection = {
				kind: DataSelectionKind.RowIndices,
				selection
			};
		} else {
			// This indicates a bug.
			return undefined;
		}

		// Export the data selection.
		const exportedData = await this._dataExplorerClientInstance.exportDataSelection(
			dataSelection,
			ExportFormat.Tsv
		);

		// If successful, return the exported data; otherwise, return undefined.
		return exportedData.data ?? undefined;
	}

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

	/**
	 * Given a status check if the feature is enabled.
	 */
	isFeatureEnabled(status: SupportStatus): boolean {
		return dataExplorerExperimentalFeatureEnabled(status, this._configurationService);
	}

	//#endregion Public Methods
}
