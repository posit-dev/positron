/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { TableDataDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableDataDataGridInstance';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';

/**
 * PositronDataExplorerInstance class.
 */
export class PositronDataExplorerInstance extends Disposable implements IPositronDataExplorerInstance {
	//#region Private Properties

	/**
	 * Gets the DataExplorerClientInstance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	private readonly _dataCache: DataExplorerCache;

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
	 * @param dataExplorerClientInstance The DataExplorerClientInstance.
	 */
	constructor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super();

		// Initialize.
		this._dataExplorerClientInstance = dataExplorerClientInstance;
		this._dataCache = new DataExplorerCache(dataExplorerClientInstance);
		this._tableSchemaDataGridInstance = new TableSummaryDataGridInstance(
			dataExplorerClientInstance,
			this._dataCache
		);
		this._tableDataDataGridInstance = new TableDataDataGridInstance(
			dataExplorerClientInstance,
			this._dataCache
		);

		// Add event handlers.
		this._register(this._tableSchemaDataGridInstance.onDidSelectColumn(columnIndex => {
			this._tableDataDataGridInstance.selectColumn(columnIndex);
			this._tableDataDataGridInstance.scrollToColumn(columnIndex);
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataExplorerInstance Implementation

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
