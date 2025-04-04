/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { TableDataCache } from '../common/tableDataCache.js';
import { TableSummaryCache } from '../common/tableSummaryCache.js';
import { PositronDataExplorerUri } from '../common/positronDataExplorerUri.js';
import { TableDataDataGridInstance } from './tableDataDataGridInstance.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { TableSummaryDataGridInstance } from './tableSummaryDataGridInstance.js';
import { PositronDataExplorerLayout } from './interfaces/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from './interfaces/positronDataExplorerInstance.js';
import { ClipboardCell, ClipboardCellRange, ClipboardColumnIndexes, ClipboardColumnRange, ClipboardRowIndexes, ClipboardRowRange } from '../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { DataExplorerSummaryCollapseEnabled, DefaultDataExplorerSummaryLayout } from './positronDataExplorerSummary.js';

/**
 * Constants.
 */
const MAX_CLIPBOARD_CELLS = 10_000;

/**
 * PositronDataExplorerInstance class.
 */
export class PositronDataExplorerInstance extends Disposable implements IPositronDataExplorerInstance {
	//#region Private Properties

	/**
	 * Gets the table summary cache.
	 */
	private readonly _tableSummaryCache: TableSummaryCache;

	/**
	 * Gets the table data cache.
	 */
	private readonly _tableDataCache: TableDataCache;

	/**
	 * Gets or sets the layout.
	 */
	private _layout = DefaultDataExplorerSummaryLayout(this._configurationService);

	/**
	 * Gets or sets a value which indicates whether the summary is collapsed.
	 */
	private _isSummaryCollapsed = DataExplorerSummaryCollapseEnabled(this._configurationService);

	/**
	 * Gets or sets the summary width in pixels.
	 */
	private _summaryWidth = 0;

	/**
	 * Gets the TableSchemaDataGridInstance.
	 */
	private readonly _tableSchemaDataGridInstance: TableSummaryDataGridInstance;

	/**
	 * Gets the TableDataDataGridInstance.
	 */
	private readonly _tableDataDataGridInstance: TableDataDataGridInstance;

	/**
	 * The onDidClose event emitter.
	 */
	private readonly _onDidCloseEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidChangeLayout event emitter.
	 */
	private readonly _onDidChangeLayoutEmitter = this._register(
		new Emitter<PositronDataExplorerLayout>
	);

	/**
	 * The onDidChangeSummaryWidth event emitter.
	 */
	private readonly _onDidChangeSummaryWidthEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidChangeColumnsScrollOffset event emitter.
	 */
	private readonly _onDidChangeColumnsScrollOffsetEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidRequestFocus event emitter.
	 */
	private readonly _onDidRequestFocusEmitter = this._register(new Emitter<void>());

	/**
	 * The onDidCollapseSummary event emitter.
	 */
	private readonly _onDidCollapseSummaryEmitter = this._register(new Emitter<void>());

	/**
	 * The onDidExpandSummary event emitter.
	 */
	private readonly _onDidExpandSummaryEmitter = this._register(new Emitter<void>());

	/**
	 * The onDidChangeColumnSorting event emitter.
	 */
	private readonly _onDidChangeColumnSortingEmitter = this._register(new Emitter<boolean>());

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _clipboardService The clipboard service.
	 * @param _commandService The command service.
	 * @param _configurationService The configuration service.
	 * @param _hoverService The hover service.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _notificationService The notification service.
	 * @param _languageName The language name.
	 * @param _dataExplorerClientInstance The DataExplorerClientInstance. The data explorer takes
	 * ownership of the client instance and will dispose it when it is disposed.
	 */
	constructor(
		private readonly _clipboardService: IClipboardService,
		private readonly _commandService: ICommandService,
		private readonly _configurationService: IConfigurationService,
		private readonly _hoverService: IHoverService,
		private readonly _keybindingService: IKeybindingService,
		private readonly _layoutService: ILayoutService,
		private readonly _notificationService: INotificationService,
		private readonly _editorService: IEditorService,
		private readonly _languageName: string,
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance
	) {
		// Call the base class's constructor.
		super();

		// Take ownership of the client instance.
		this._register(this._dataExplorerClientInstance);

		// Create the table summary cache.
		this._register(this._tableSummaryCache = new TableSummaryCache(
			this._configurationService,
			this._dataExplorerClientInstance
		));

		// Create the table summary data grid instance.
		this._register(this._tableSchemaDataGridInstance = new TableSummaryDataGridInstance(
			this._configurationService,
			this._hoverService,
			this._dataExplorerClientInstance,
			this._tableSummaryCache
		));

		// Create the table data cache.
		this._register(this._tableDataCache = new TableDataCache(this._dataExplorerClientInstance));

		// Create the table data data grid instance.
		this._register(this._tableDataDataGridInstance = new TableDataDataGridInstance(
			this._commandService,
			this._configurationService,
			this._keybindingService,
			this._layoutService,
			this._hoverService,
			this._dataExplorerClientInstance,
			this._tableDataCache
		));
		// Add the onDidClose event handler.
		this._register(this._dataExplorerClientInstance.onDidClose(() => {
			this._onDidCloseEmitter.fire();
		}));

		// Add the onDidSelectColumn event handler.
		this._register(this._tableSchemaDataGridInstance.onDidSelectColumn(columnIndex => {
			this._tableDataDataGridInstance.selectColumn(columnIndex);
			this._tableDataDataGridInstance.scrollToColumn(columnIndex);
		}));

		// Add the onDidChangeColumnSorting event handler.
		this._register(
			this._tableDataDataGridInstance.onDidChangeColumnSorting(isColumnSorting =>
				this._onDidChangeColumnSortingEmitter.fire(isColumnSorting)
			)
		);

		// Add the onDidRequestFocus event handler.
		this._register(this.onDidRequestFocus(() => {
			const uri = PositronDataExplorerUri.generate(this._dataExplorerClientInstance.identifier);
			this._editorService.openEditor({ resource: uri });
		}));
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Fire the onDidClose event.
		this._onDidCloseEmitter.fire();

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataExplorerInstance Implementation

	/**
	 * Gets the language name.
	 */
	get languageName() {
		return this._languageName;
	}

	/**
	 * Gets the data explorer client instance.
	 */
	get dataExplorerClientInstance() {
		return this._dataExplorerClientInstance;
	}

	/**
	 * Gets the layout.
	 */
	get layout() {
		return this._layout;
	}

	/**
	 * Sets the layout.
	 */
	set layout(layout: PositronDataExplorerLayout) {
		this._layout = layout;
		this._onDidChangeLayoutEmitter.fire(this._layout);
	}

	/**
	 * Gets a value which indicates whether the summary is collapsed.
	 */
	get isSummaryCollapsed() {
		return this._isSummaryCollapsed;
	}

	/**
	 * Gets the summary width in pixels.
	 */
	get summaryWidth() {
		return this._summaryWidth;
	}

	/**
	 * Sets the summary width in pixels.
	 */
	set summaryWidth(summaryWidth: number) {
		this._summaryWidth = summaryWidth;
		this._onDidChangeSummaryWidthEmitter.fire(this._summaryWidth);
	}

	/**
	 * Gets the TableSchemaDataGridInstance.
	 */
	get tableSchemaDataGridInstance() {
		return this._tableSchemaDataGridInstance;
	}

	/**
	 * Gets the TableDataDataGridInstance.
	 */
	get tableDataDataGridInstance() {
		return this._tableDataDataGridInstance;
	}

	/**
	 * Gets a value which indicates whether one or more columns are sorted.
	 */
	get isColumnSorting() {
		return this._tableDataDataGridInstance.isColumnSorting;
	}

	/**
	 * Requests focus.
	 */
	requestFocus(): void {
		this._onDidRequestFocusEmitter.fire();
	}

	/**
	 * Collapses the summary.
	 */
	collapseSummary(): void {
		this._isSummaryCollapsed = true;
		this._onDidCollapseSummaryEmitter.fire();
	}

	/**
	 * Expands the summary.
	 */
	expandSummary(): void {
		this._isSummaryCollapsed = false;
		this._onDidExpandSummaryEmitter.fire();
	}

	/**
	 * Clears column sorting.
	 * @returns A Promise<void> that resolves when column sorting has been cleared.
	 */
	async clearColumnSorting(): Promise<void> {
		await this._tableDataDataGridInstance.clearColumnSortKeys();
	}

	/**
	 * Copies the selection or cursor cell to the clipboard.
	 */
	async copyToClipboard(): Promise<void> {
		/**
		 * Notifies the user that there is nothing to copy to the clipboard.
		 */
		const notifyUserNothingToCopy = () => {
			this._notificationService.info(
				localize(
					'positron.dataExplorer.nothingToCopy',
					'There is nothing to copy to the clipboard.'
				)
			);
		};

		// Get the clipboard data.
		const clipboardData = this._tableDataDataGridInstance.getClipboardData();
		if (!clipboardData) {
			notifyUserNothingToCopy();
			return;
		}

		// Calculate the number of selected clipboard cells.
		let selectedClipboardCells;
		if (clipboardData instanceof ClipboardCell) {
			selectedClipboardCells = 1;
		} else if (clipboardData instanceof ClipboardCellRange) {
			const columns = Math.max(clipboardData.lastColumnIndex - clipboardData.firstColumnIndex, 1);
			const rows = Math.max(clipboardData.lastRowIndex - clipboardData.firstRowIndex, 1);
			selectedClipboardCells = columns * rows;
		} else if (clipboardData instanceof ClipboardColumnRange) {
			const columns = clipboardData.lastColumnIndex - clipboardData.firstColumnIndex;
			selectedClipboardCells = columns * this._tableDataCache.rows;
		} else if (clipboardData instanceof ClipboardColumnIndexes) {
			selectedClipboardCells = clipboardData.indexes.length * this._tableDataCache.rows;
		} else if (clipboardData instanceof ClipboardRowRange) {
			const rows = clipboardData.lastRowIndex - clipboardData.firstRowIndex;
			selectedClipboardCells = rows * this._tableDataCache.columns;
		} else if (clipboardData instanceof ClipboardRowIndexes) {
			selectedClipboardCells = clipboardData.indexes.length * this._tableDataCache.columns;
		} else {
			// This indicates a bug.
			selectedClipboardCells = 0;
		}

		// If there are no clipboard cells selected, notify the user.
		if (!selectedClipboardCells) {
			notifyUserNothingToCopy();
			return;
		}

		// If there are too many clipboard cells selected, notify the user.
		if (selectedClipboardCells > MAX_CLIPBOARD_CELLS) {
			this._notificationService.error(
				localize(
					'positron.dataExplorer.tooMuchDataToCopy',
					'There is too much data selected to copy to the clipboard.'
				)
			);
			return;
		}

		// Copy the clipboard data.
		const text = await this._tableDataDataGridInstance.copyClipboardData(clipboardData);
		if (!text) {
			notifyUserNothingToCopy();
			return;
		}

		// Write the clipboard data to the clipboard.
		this._clipboardService.writeText(text);
	}

	/**
	 * Copies the table data to the clipboard.
	 */
	async copyTableDataToClipboard(): Promise<void> {
		// Inform the user that the table data is being prepared.
		const notificationHandle = this._notificationService.notify({
			severity: Severity.Info,
			message: localize(
				'positron.dataExplorer.preparingTableDate',
				'Preparing table data'
			),
			progress: {
				infinite: true
			}
		});

		// Get the table data in TSV format.
		const tableDataTSV = await this._tableDataCache.getTableDataTSV();

		// Inform the user that the table data is being copied to the clipboard..
		notificationHandle.updateMessage(localize(
			'positron.dataExplorer.copyingToClipboard',
			'Copying table data to the clipboard'
		));

		// Write the table data to the clipboard.
		this._clipboardService.writeText(tableDataTSV);

		// Inform the user that the operation is done.
		notificationHandle.updateMessage(localize(
			'positron.dataExplorer.copiedToClipboard',
			'Table data copied to the clipboard'
		));

		// Done.
		notificationHandle.progress.done();
	}

	/**
	 * onDidClose event.
	 */
	readonly onDidClose = this._onDidCloseEmitter.event;

	/**
	 * onDidChangeLayout event.
	 */
	readonly onDidChangeLayout = this._onDidChangeLayoutEmitter.event;

	/**
	 * onDidChangeSummaryWidth event.
	 */
	readonly onDidChangeSummaryWidth = this._onDidChangeSummaryWidthEmitter.event;

	/**
	 * onDidChangeColumnsScrollOffset event.
	 */
	readonly onDidChangeColumnsScrollOffset = this._onDidChangeColumnsScrollOffsetEmitter.event;

	/**
	 * onDidRequestFocus event.
	 */
	readonly onDidRequestFocus = this._onDidRequestFocusEmitter.event;

	/**
	 * onDidCollapseSummary event.
	 */
	readonly onDidCollapseSummary = this._onDidCollapseSummaryEmitter.event;

	/**
	 * onDidExpandSummary event.
	 */
	readonly onDidExpandSummary = this._onDidExpandSummaryEmitter.event;

	/**
	 * The onDidChangeColumnSorting event.
	 */
	readonly onDidChangeColumnSorting = this._onDidChangeColumnSortingEmitter.event;

	//#endregion IPositronDataExplorerInstance Implementation
}
