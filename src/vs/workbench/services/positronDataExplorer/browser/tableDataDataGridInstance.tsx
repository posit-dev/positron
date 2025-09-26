/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
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
import { BackendState, ColumnSchema, DataSelectionCellIndices, DataSelectionIndices, DataSelectionSingleCell, ExportFormat, RowFilter, SupportStatus, TableSelection, TableSelectionKind } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { ClipboardCell, ClipboardCellIndexes, ClipboardColumnIndexes, ClipboardData, ClipboardRowIndexes, ColumnSelectionState, ColumnSortKeyDescriptor, DataGridInstance, MouseSelectionType, RowSelectionState } from '../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { PositronReactServices } from '../../../../base/browser/positronReactServices.js';

/**
 * Constants.
 */
const OVERSCAN_FACTOR = 3;

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
	 * Gets the Positron React services.
	 */
	private readonly _services = PositronReactServices.services;

	/**
	 * The onAddFilter event emitter.
	 */
	private readonly _onAddFilterEmitter = this._register(new Emitter<ColumnSchema>);

	/**
	 * The hover manager for data cell tooltips and corner reset button.
	 */
	private readonly _hoverManager: PositronActionBarHoverManager;

	/**
	 * The onDidChangePinnedColumns event emitter.
	 * This event is fired when the pinned columns change.
	 * This event returns the array of pinned column indexes.
	 */
	private readonly _onDidChangePinnedColumns = this._register(new Emitter<number[]>());

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 * @param _tableDataCache The table data cache.
	 */
	constructor(
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
			columnPinning: true,
			maximumPinnedColumns: 10,
			rowPinning: true,
			maximumPinnedRows: 10,
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

		this._hoverManager = this._register(new PositronActionBarHoverManager(false, this._services.configurationService, this._services.hoverService));
		this._hoverManager.setCustomHoverDelay(500);

		/**
		 * Updates the layout entries.
		 * @param state The backend state, if known; otherwise, undefined.
		 */
		const updateLayoutEntries = async (state?: BackendState) => {
			// Get the backend state, if was not provided.
			if (!state) {
				state = await this._dataExplorerClientInstance.getBackendState();
			}

			// Calculate column widths.
			const columnWidths = await this._tableDataCache.calculateColumnWidths(
				this.minimumColumnWidth,
				this.maximumColumnWidth
			);

			// Set the layout entries.
			this._columnLayoutManager.setEntries(state.table_shape.num_columns, columnWidths);
			this._rowLayoutManager.setEntries(state.table_shape.num_rows);

			// For zero-row case (e.g., after filtering), ensure a full reset of scroll positions
			if (state.table_shape.num_rows === 0) {
				this._verticalScrollOffset = 0;
				this._horizontalScrollOffset = 0;
				// Force a layout recomputation and repaint
				this.softReset();
				this.fireOnDidUpdateEvent();
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
			this.fireOnDidUpdateEvent()
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
	 * Pins a column and fires the onDidPinnedColumnsChange event.
	 *
	 * This allows the summary panel to keep the pinned/unpinned
	 * columns in sync with the data grid.
	 *
	 * @param columnIndex The index of the column to pin.
	 */
	override pinColumn(columnIndex: number) {
		// Call the parent method
		super.pinColumn(columnIndex);

		// Fire the event with current pinned column indices
		this._onDidChangePinnedColumns.fire(this._columnLayoutManager.pinnedIndexes);
	}

	/**
	 * Unpins a column and fires the onDidPinnedColumnsChange event.
	 *
	 * This allows the summary panel to keep the pinned/unpinned
	 * columns in sync with the data grid.
	 *
	 * @param columnIndex The index of the column to unpin.
	 */
	override unpinColumn(columnIndex: number) {
		// Call the parent method
		super.unpinColumn(columnIndex);

		// Fire the event with current pinned column indices
		this._onDidChangePinnedColumns.fire(this._columnLayoutManager.pinnedIndexes);
	}

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	override async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
		// Clear pinned rows whenever a sort is applied to avoid
		// the bug where pinned row data is in the wrong position.
		// See https://github.com/posit-dev/positron/issues/9344
		this.clearPinnedRows();

		// Set the sort columns.
		await this._dataExplorerClientInstance.setSortColumns(columnSorts.map(columnSort => ({
			column_index: columnSort.columnIndex,
			ascending: columnSort.ascending
		})));

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
				columnIndices: this._columnLayoutManager.getLayoutIndexes(this.horizontalScrollOffset, this.layoutWidth, OVERSCAN_FACTOR),
				rowIndices: this._rowLayoutManager.getLayoutIndexes(this.verticalScrollOffset, this.layoutHeight, OVERSCAN_FACTOR)
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

		// We update the cache as long as there is a column in the dataset.
		// This allows datasets with column headers but zero rows to render
		// the column headers in the data grid.
		// See https://github.com/posit-dev/positron/issues/9619
		if (columnDescriptor) {
			// Update the cache.
			await this._tableDataCache.update({
				invalidateCache: invalidateCacheFlags ?? InvalidateCacheFlags.None,
				columnIndices: this._columnLayoutManager.getLayoutIndexes(this.horizontalScrollOffset, this.layoutWidth, OVERSCAN_FACTOR),
				rowIndices: rowDescriptor ? this._rowLayoutManager.getLayoutIndexes(this.verticalScrollOffset, this.layoutHeight, OVERSCAN_FACTOR) : []
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
	 * Override base class to provide hover manager.
	 */
	override get hoverManager(): PositronActionBarHoverManager {
		return this._hoverManager;
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
				hoverManager={this._hoverManager}
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
		// Ensure the column is selected (handles both right-click and dropdown button cases)
		await this.mouseSelectColumn(columnIndex, MouseSelectionType.Single);

		// Get the supported features.
		const features = this._dataExplorerClientInstance.getSupportedFeatures();
		const copySupported = this.isFeatureEnabled(features.export_data_selection?.support_status);
		const sortSupported = this.isFeatureEnabled(features.set_sort_columns?.support_status);
		const filterSupported = this.isFeatureEnabled(features.set_row_filters?.support_status);

		// Get the column sort key for the column.
		const columnSortKey = sortSupported ? this.columnSortKey(columnIndex) : undefined;

		// Build the entries.
		const entries: CustomContextMenuEntry[] = [];
		entries.push(new CustomContextMenuItem({
			commandId: PositronDataExplorerCommandId.CopyAction,
			checked: false,
			disabled: !copySupported,
			icon: 'copy',
			label: localize('positron.dataExplorer.copyColumn', "Copy Column"),
			onSelected: () => console.log('Copy Column')
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-select-column',
			label: localize('positron.dataExplorer.selectColumn', "Select Column"),
			disabled: this.columnSelectionState(columnIndex) !== ColumnSelectionState.None,
			onSelected: () => this.selectColumn(columnIndex)
		}));
		if (this.columnPinning) {
			entries.push(new CustomContextMenuSeparator());
			if (!this.isColumnPinned(columnIndex)) {
				entries.push(new CustomContextMenuItem({
					checked: false,
					disabled: false,
					icon: 'positron-pin',
					label: localize('positron.dataExplorer.pinColumn', "Pin Column"),
					onSelected: () => this.pinColumn(columnIndex)
				}));
			} else {
				entries.push(new CustomContextMenuItem({
					checked: false,
					icon: 'positron-unpin',
					label: localize('positron.dataExplorer.unpinColumn', "Unpin Column"),
					onSelected: () => this.unpinColumn(columnIndex)
				}));
			}
		}
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
		// Ensure the row is selected (handles both right-click and keyboard shortcut cases)
		await this.mouseSelectRow(rowIndex, MouseSelectionType.Single);

		const features = this._dataExplorerClientInstance.getSupportedFeatures();
		const copySupported = this.isFeatureEnabled(features.export_data_selection.support_status);

		// Build the entries.
		const entries: CustomContextMenuEntry[] = [];
		entries.push(new CustomContextMenuItem({
			commandId: PositronDataExplorerCommandId.CopyAction,
			checked: false,
			disabled: !copySupported,
			icon: 'copy',
			label: localize('positron.dataExplorer.copyRow', "Copy Row"),
			onSelected: () => console.log('Copy Row')
		}));
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			checked: false,
			icon: 'positron-select-row',
			label: localize('positron.dataExplorer.selectRow', "Select Row"),
			disabled: this.rowSelectionState(rowIndex) !== RowSelectionState.None,
			onSelected: () => this.selectRow(rowIndex)
		}));
		if (this.rowPinning) {
			entries.push(new CustomContextMenuSeparator());
			if (!this.isRowPinned(rowIndex)) {
				entries.push(new CustomContextMenuItem({
					checked: false,
					disabled: false,
					icon: 'positron-pin',
					label: localize('positron.dataExplorer.pinRow', "Pin Row"),
					onSelected: () => this.pinRow(rowIndex)
				}));
			} else {
				entries.push(new CustomContextMenuItem({
					checked: false,
					icon: 'positron-unpin',
					label: localize('positron.dataExplorer.unpinRow', "Unpin Row"),
					onSelected: () => this.unpinRow(rowIndex)
				}));
			}
		}

		// Show the context menu.
		await showCustomContextMenu({
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
		if (this.columnPinning) {
			entries.push(new CustomContextMenuSeparator());
			if (!this.isColumnPinned(columnIndex)) {
				entries.push(new CustomContextMenuItem({
					checked: false,
					disabled: false,
					icon: 'positron-pin',
					label: localize('positron.dataExplorer.pinColumn', "Pin Column"),
					onSelected: () => this.pinColumn(columnIndex)
				}));
			} else {
				entries.push(new CustomContextMenuItem({
					checked: false,
					icon: 'positron-unpin',
					label: localize('positron.dataExplorer.unpinColumn', "Unpin Column"),
					onSelected: () => this.unpinColumn(columnIndex)
				}));
			}
		}
		if (this.rowPinning) {
			if (!this.columnPinning) {
				entries.push(new CustomContextMenuSeparator());
			}
			if (!this.isRowPinned(rowIndex)) {
				entries.push(new CustomContextMenuItem({
					checked: false,
					icon: 'positron-pin',
					label: localize('positron.dataExplorer.pinRow', "Pin Row"),
					onSelected: () => this.pinRow(rowIndex)
				}));
			} else {
				entries.push(new CustomContextMenuItem({
					checked: false,
					icon: 'positron-unpin',
					label: localize('positron.dataExplorer.unpinRow', "Unpin Row"),
					onSelected: () => this.unpinRow(rowIndex)
				}));
			}
		}
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

	/**
	 * The onDidChangePinnedColumns event.
	 */
	readonly onDidChangePinnedColumns = this._onDidChangePinnedColumns.event;

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
		} else if (clipboardData instanceof ClipboardCellIndexes) {
			const selection: DataSelectionCellIndices = {
				column_indices: clipboardData.columnIndexes,
				row_indices: clipboardData.rowIndexes
			};
			dataSelection = {
				kind: TableSelectionKind.CellIndices,
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
		// Clear pinned rows whenever a filter is applied to avoid
		// the bug where pinned row data is in the wrong position.
		// See https://github.com/posit-dev/positron/issues/9344
		this.clearPinnedRows();

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
				columnIndices: this._columnLayoutManager.getLayoutIndexes(this.horizontalScrollOffset, this.layoutWidth, OVERSCAN_FACTOR),
				rowIndices: this._rowLayoutManager.getLayoutIndexes(this.verticalScrollOffset, this.layoutHeight, OVERSCAN_FACTOR)
			});
		}
	}

	/**
	 * Given a status check if the feature is enabled.
	 */
	isFeatureEnabled(status: SupportStatus): boolean {
		return dataExplorerExperimentalFeatureEnabled(status, this._services.configurationService);
	}

	//#endregion Public Methods
}
