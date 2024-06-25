/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';
import { TableDataDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableDataDataGridInstance';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';
import { ClipboardCell, ClipboardCellRange, ClipboardColumnIndexes, ClipboardColumnRange, ClipboardRowIndexes, ClipboardRowRange } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';

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
	 * Gets the DataExplorerCache.
	 */
	private readonly _dataExplorerCache: DataExplorerCache;

	/**
	 * Gets or sets the layout.
	 */
	private _layout = PositronDataExplorerLayout.ColumnsLeft;

	/**
	 * Gets or sets the columns width percent.
	 */
	private _columnsWidthPercent = 0.25;

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
	 * The onDidChangeColumnsWidthPercent event emitter.
	 */
	private readonly _onDidChangeColumnsWidthPercentEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidChangeColumnsScrollOffset event emitter.
	 */
	private readonly _onDidChangeColumnsScrollOffsetEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidRequestFocus event emitter.
	 */
	private readonly _onDidRequestFocusEmitter = this._register(new Emitter<void>());

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
		private readonly _languageName: string,
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance
	) {
		// Call the base class's constructor.
		super();

		// Initialize.
		this._dataExplorerCache = new DataExplorerCache(this._dataExplorerClientInstance);
		this._tableSchemaDataGridInstance = new TableSummaryDataGridInstance(
			this._configurationService,
			this._hoverService,
			this._dataExplorerClientInstance,
			this._dataExplorerCache
		);
		this._tableDataDataGridInstance = new TableDataDataGridInstance(
			this._commandService,
			this._keybindingService,
			this._layoutService,
			this._dataExplorerClientInstance,
			this._dataExplorerCache,
			this._configurationService
		);

		// Add the onDidClose event handler.
		this._register(this._dataExplorerClientInstance.onDidClose(() => {
			this._onDidCloseEmitter.fire();
		}));

		// Add the onDidSelectColumn event handler.
		this._register(this._tableSchemaDataGridInstance.onDidSelectColumn(columnIndex => {
			this._tableDataDataGridInstance.selectColumn(columnIndex);
			this._tableDataDataGridInstance.scrollToColumn(columnIndex);
		}));
	}

	/**
	 * dispose override method.
	 */
	override dispose(): void {
		// Dispose the client instance.
		this._dataExplorerClientInstance.dispose();

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
	 * Gets the columns width percent.
	 */
	get columnsWidthPercent() {
		return this._columnsWidthPercent;
	}

	/**
	 * Sets the columns width percent.
	 */
	set columnsWidthPercent(columnsWidthPercent: number) {
		this._columnsWidthPercent = columnsWidthPercent;
		this._onDidChangeColumnsWidthPercentEmitter.fire(this._columnsWidthPercent);
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
	 * Requests focus.
	 */
	requestFocus(): void {
		this._onDidRequestFocusEmitter.fire();
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
			selectedClipboardCells = columns * this._dataExplorerCache.rows;
		} else if (clipboardData instanceof ClipboardColumnIndexes) {
			selectedClipboardCells = clipboardData.indexes.length * this._dataExplorerCache.rows;
		} else if (clipboardData instanceof ClipboardRowRange) {
			const rows = clipboardData.lastRowIndex - clipboardData.firstRowIndex;
			selectedClipboardCells = rows * this._dataExplorerCache.columns;
		} else if (clipboardData instanceof ClipboardRowIndexes) {
			selectedClipboardCells = clipboardData.indexes.length * this._dataExplorerCache.columns;
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
	 * onDidClose event.
	 */
	readonly onDidClose = this._onDidCloseEmitter.event;

	/**
	 * onDidChangeLayout event.
	 */
	readonly onDidChangeLayout = this._onDidChangeLayoutEmitter.event;

	/**
	 * onDidChangeColumnsWidthPercent event.
	 */
	readonly onDidChangeColumnsWidthPercent = this._onDidChangeColumnsWidthPercentEmitter.event;

	/**
	 * onDidChangeColumnsScrollOffset event.
	 */
	readonly onDidChangeColumnsScrollOffset = this._onDidChangeColumnsScrollOffsetEmitter.event;

	/**
	 * onDidRequestFocus event.
	 */
	readonly onDidRequestFocus = this._onDidRequestFocusEmitter.event;

	//#endregion IPositronDataExplorerInstance Implementation
}
