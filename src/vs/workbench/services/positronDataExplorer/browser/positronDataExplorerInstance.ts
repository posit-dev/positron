/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';
import { PositronDataExplorerDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerDataGridInstance';

/**
* PositronDataExplorerInstance class.
*/
export class PositronDataExplorerInstance extends Disposable implements IPositronDataExplorerInstance {
	//#region Private Properties

	/**
	 * Gets the DataToolClientInstance.
	 */
	private readonly _dataToolClientInstance: DataExplorerClientInstance;

	/**
	 * Gets or sets the layout.
	 */
	private _layout = PositronDataExplorerLayout.ColumnsLeft;

	/**
	 * Gets or sets the columns width percent.
	 */
	private _columnsWidthPercent = 0.25;

	/**
	 * Gets or sets the columns scroll offset.
	 */
	private _columnsScrollOffset = 0;

	/**
	 * The PositronDataToolDataGridInstance.
	 */
	private _positronDataToolDataGridInstance: PositronDataExplorerDataGridInstance;

	/**
	 * The onDidChangeLayout event emitter.
	 */
	private readonly _onDidChangeLayoutEmitter = this._register(new Emitter<PositronDataExplorerLayout>);

	/**
	 * The onDidChangeColumnsWidthPercent event emitter.
	 */
	private readonly _onDidChangeColumnsWidthPercentEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidChangeColumnsScrollOffset event emitter.
	 */
	private readonly _onDidChangeColumnsScrollOffsetEmitter = this._register(new Emitter<number>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param dataToolClientInstance The DataToolClientInstance.
	 */
	constructor(dataToolClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super();

		// Initialize.
		this._dataToolClientInstance = dataToolClientInstance;
		this._positronDataToolDataGridInstance = new PositronDataExplorerDataGridInstance(dataToolClientInstance);
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataExplorerInstance Implementation

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		return this._dataToolClientInstance.identifier;
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
	 * Gets the columns scroll offset.
	 */
	get columnsScrollOffset() {
		return this._columnsScrollOffset;
	}

	/**
	 * Sets the columns scroll offset.
	 */
	set columnsScrollOffset(columnsScrollOffset: number) {
		this._columnsScrollOffset = columnsScrollOffset;
		this._onDidChangeColumnsScrollOffsetEmitter.fire(this._columnsScrollOffset);
	}

	/**
	 * Gets the
	 */
	get dataGridInstance() {
		return this._positronDataToolDataGridInstance;
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

	//#endregion IPositronDataExplorerInstance Implementation
}
