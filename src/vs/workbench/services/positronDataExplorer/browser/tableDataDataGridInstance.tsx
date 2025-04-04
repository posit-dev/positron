/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { IColumnSortKey } from '../../../browser/positronDataGrid/interfaces/columnSortKey.js';
import { TableDataCell } from './components/tableDataCell.js';
import { AnchorPoint } from '../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { TableDataRowHeader } from './components/tableDataRowHeader.js';
import { CustomContextMenuItem } from '../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { PositronDataExplorerColumn } from './positronDataExplorerColumn.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { CustomContextMenuSeparator } from '../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { PositronDataExplorerCommandId } from '../../../contrib/positronDataExplorerEditor/browser/positronDataExplorerActions.js';
import { InvalidateCacheFlags, TableDataCache, WidthCalculators } from '../common/tableDataCache.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { dataExplorerExperimentalFeatureEnabled } from '../common/positronDataExplorerExperimentalConfig.js';
import { BackendState, ColumnSchema, DataSelectionCellRange, DataSelectionIndices, DataSelectionRange, DataSelectionSingleCell, ExportFormat, RowFilter, SupportStatus, TableSelection, TableSelectionKind } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { ClipboardCell, ClipboardCellRange, ClipboardColumnIndexes, ClipboardColumnRange, ClipboardData, ClipboardRowIndexes, ClipboardRowRange, ColumnSelectionState, ColumnSortKeyDescriptor, DataGridInstance, RowSelectionState } from '../../../browser/positronDataGrid/classes/dataGridInstance.js';

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

	/**
	 * The cell hover manager with longer delay for data cell tooltips.
	 */
	private readonly _cellHoverManager: PositronActionBarHoverManager;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _commandService The command service.
	 * @param _configurationService The configuration service.
	 * @param _hoverService The hover service.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 * @param _tableDataCache The table data cache.
	 */
	constructor(
		private readonly _commandService: ICommandService,
		private readonly _configurationService: IConfigurationService,
		private readonly _keybindingService: IKeybindingService,
		private readonly _layoutService: ILayoutService,
		private readonly _hoverService: IHoverService,
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance,
		private readonly _tableDataCache: TableDataCache,
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
			minimumColumnWidth: 80,
			maximumColumnWidth: 800,
			rowResize: false,
			horizontalScrollbar: true,
			verticalScrollbar: true,
			scrollbarThickness: 14,
			scrollbarOverscroll: 14,
			useEditorFont: true,
			automaticLayout: true,
			cellBorders: true,
			horizontalCellPadding: 7,
			internalCursor: true,
			cursorOffset: 0.5,
		});

		this._cellHoverManager = this._register(new PositronActionBarHoverManager(false, this._configurationService, this._hoverService));
		this._cellHoverManager.setCustomHoverDelay(500);

		/**
		 * Updates the layout entries.
		 * @param state The backend state, if known; otherwise, undefined.
		 */
		const updateLayoutEntries = async (state?: BackendState) => {
			// Get the backend state, if was not provided.
			if (!state) {
				state = await this._dataExplorerClientInstance.getBackendState();
			}

			// Calculate the layout entries.
			const layoutEntries = await this._tableDataCache.calculateColumnLayoutEntries(
				this.minimumColumnWidth,
				this.maximumColumnWidth
			);

			// Set the layout entries.
			this._columnLayoutManager.setLayoutEntries(
				layoutEntries ?? state.table_shape.num_columns
			);
			this._rowLayoutManager.setLayoutEntries(
				state.table_shape.num_rows
			);

			// For zero-row case (e.g., after filtering), ensure a full reset of scroll positions
			if (state.table_shape.num_rows === 0) {
				this._verticalScrollOffset = 0;
				this._horizontalScrollOffset = 0;
				// Force a layout recomputation and repaint
				this.softReset();
				this._onDidUpdateEmitter.fire();
			} else {
				// Adjust the vertical scroll offset, if needed.
				if (!this.firstRow) {
					this._verticalScrollOffset = 0;
				} else if (this._verticalScrollOffset > this.maximumVerticalScrollOffset) {
					this._verticalScrollOffset = this.maximumVerticalScrollOffset;
				}

				// Adjust the horizontal scroll offset, if needed.
				if (!this.firstColumn) {
					this._horizontalScrollOffset = 0;
				} else if (this._horizontalScrollOffset > this.maximumHorizontalScrollOffset) {
					this._horizontalScrollOffset = this.maximumHorizontalScrollOffset;
				}
			}
		};

		// Add the data explorer client onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Update the layout entries.
			await updateLayoutEntries();

			// Perform a soft reset.
			this.softReset();

			// Update the cache.
			await this.fetchData(InvalidateCacheFlags.All);
		}));

		// Add the data explorer client onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			// Update the layout entries.
			await updateLayoutEntries();

			// Update the cache.
			await this.fetchData(InvalidateCacheFlags.Data);
		}));

		// Add the data explorer client onDidUpdateBackendState event handler.
		this._register(this._dataExplorerClientInstance.onDidUpdateBackendState(async state => {
			// Update the layout entries.
			await updateLayoutEntries(state);

			// Clear column sort keys.
			this._columnSortKeys.clear();

			// Update the column sort keys from the state.
			state.sort_keys.forEach((key, sortIndex) => {
				this._columnSortKeys.set(
					key.column_index,
					new ColumnSortKeyDescriptor(sortIndex, key.column_index, key.ascending)
				);
			});

			// Fetch data.
			await this.fetchData(InvalidateCacheFlags.Data);
		}));

		// Add the table data cache onDidUpdate event handler.
		this._register(this._tableDataCache.onDidUpdate(() =>
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
		return this._tableDataCache.columns;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._tableDataCache.rows;
	}

	/**
	 * Gets the page height.
	 */
	override get pageHeight() {
		return this.layoutHeight - this.defaultRowHeight;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	override async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
		// Set the sort columns.
		await this._dataExplorerClientInstance.setSortColumns(columnSorts.map(columnSort => ({
			column_index: columnSort.columnIndex,
			ascending: columnSort.ascending
		})));

		// Get the first column layout entry and the first row layout entry. If they were found,
		// update the cache.
		const columnDescriptor = this.firstColumn;
		const rowDescriptor = this.firstRow;
		if (columnDescriptor && rowDescriptor) {
			// Update the cache.
			await this._tableDataCache.update({
				invalidateCache: InvalidateCacheFlags.Data,
				firstColumnIndex: columnDescriptor.columnIndex,
				screenColumns: this.screenColumns,
				firstRowIndex: rowDescriptor.rowIndex,
				screenRows: this.screenRows
			});
		}
	}

	/**
	 * Fetches data.
	 * @param invalidateCacheFlags The invalidate cache flags.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData(invalidateCacheFlags?: InvalidateCacheFlags) {
		const columnDescriptor = this.firstColumn;
		const rowDescriptor = this.firstRow;
		if (columnDescriptor && rowDescriptor) {
			await this._tableDataCache.update({
				invalidateCache: invalidateCacheFlags ?? InvalidateCacheFlags.None,
				firstColumnIndex: columnDescriptor.columnIndex,
				screenColumns: this.screenColumns,
				firstRowIndex: rowDescriptor.rowIndex,
				screenRows: this.screenRows
			});
		}
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	override column(columnIndex: number) {
		// Get the column schema.
		const columnSchema = this._tableDataCache.getColumnSchema(columnIndex);
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
			<TableDataRowHeader value={this._tableDataCache.getRowLabel(rowIndex)} />
		);
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	/**
	 * Gets the cell hover manager.
	 * @returns The cell hover manager.
	 */
	get cellHoverManager(): PositronActionBarHoverManager {
		return this._cellHoverManager;
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
		const dataCell = this._tableDataCache.getDataCell(columnIndex, rowIndex);
		if (!dataCell) {
			return undefined;
		}

		// Return the TableDataCell.
		return (
			<TableDataCell
				column={column}
				dataCell={dataCell}
				hoverManager={this._cellHoverManager}
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
				const columnSchema = this._tableDataCache.getColumnSchema(columnIndex);
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
				const columnSchema = this._tableDataCache.getColumnSchema(columnIndex);
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
	 * Sets the width calculators.
	 * @param widthCalculators The width calculators.
	 */
	setWidthCalculators(widthCalculators?: WidthCalculators) {
		this._tableDataCache.setWidthCalculators(widthCalculators);
	}

	/**
	 * Copies the specified clipboard data.
	 * @param clipboardData The clipboard data to copy.
	 * @returns The clipboard data, or undefined, if it could not be copied.
	 */
	async copyClipboardData(clipboardData: ClipboardData): Promise<string | undefined> {
		// Construct the data selection based on the clipboard data.
		let dataSelection: TableSelection;
		if (clipboardData instanceof ClipboardCell) {
			const selection: DataSelectionSingleCell = {
				column_index: clipboardData.columnIndex,
				row_index: clipboardData.rowIndex,
			};
			dataSelection = {
				kind: TableSelectionKind.SingleCell,
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
				kind: TableSelectionKind.CellRange,
				selection
			};
		} else if (clipboardData instanceof ClipboardColumnRange) {
			const selection: DataSelectionRange = {
				first_index: clipboardData.firstColumnIndex,
				last_index: clipboardData.lastColumnIndex
			};
			dataSelection = {
				kind: TableSelectionKind.ColumnRange,
				selection
			};
		} else if (clipboardData instanceof ClipboardColumnIndexes) {
			const selection: DataSelectionIndices = {
				indices: clipboardData.indexes
			};
			dataSelection = {
				kind: TableSelectionKind.ColumnIndices,
				selection
			};
		} else if (clipboardData instanceof ClipboardRowRange) {
			const selection: DataSelectionRange = {
				first_index: clipboardData.firstRowIndex,
				last_index: clipboardData.lastRowIndex
			};
			dataSelection = {
				kind: TableSelectionKind.RowRange,
				selection
			};
		} else if (clipboardData instanceof ClipboardRowIndexes) {
			const selection: DataSelectionIndices = {
				indices: clipboardData.indexes
			};
			dataSelection = {
				kind: TableSelectionKind.RowIndices,
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

		// Get the first column layout entry and the first row layout entry. If they were found,
		// update the cache.
		const columnDescriptor = this.firstColumn;
		const rowDescriptor = this.firstRow;
		if (columnDescriptor && rowDescriptor) {
			// Update the cache.
			await this._tableDataCache.update({
				invalidateCache: InvalidateCacheFlags.Data,
				firstColumnIndex: columnDescriptor.columnIndex,
				screenColumns: this.screenColumns,
				firstRowIndex: rowDescriptor.rowIndex,
				screenRows: this.screenRows
			});
		}
	}

	/**
	 * Given a status check if the feature is enabled.
	 */
	isFeatureEnabled(status: SupportStatus): boolean {
		return dataExplorerExperimentalFeatureEnabled(status, this._configurationService);
	}

	//#endregion Public Methods
}
