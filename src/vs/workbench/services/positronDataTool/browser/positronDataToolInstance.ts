/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolColumn';
import { PositronDataToolLayout } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';
import { IPositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolInstance';
import { PositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/positronDataToolColumn';

/**
* PositronDataToolInstance class.
*/
export class PositronDataToolInstance extends Disposable implements IPositronDataToolInstance {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private readonly _identifier: string;

	/**
	 * Gets or sets the layout.
	 */
	private _layout = PositronDataToolLayout.ColumnsLeft;

	/**
	 * Gets or sets the columns width percent.
	 */
	private _columnsWidthPercent = 0.25;

	/**
	 * Gets or sets the columns.
	 */
	private _columns: IPositronDataToolColumn[];

	/**
	 * Gets or sets the columns scroll offset.
	 */
	private _columnsScrollOffset = 0;

	/**
	 * Gets or sets the rows scroll offset.
	 */
	private _rowsScrollOffset = 0;

	/**
	 * The onDidChangeLayout event emitter.
	 */
	private readonly _onDidChangeLayoutEmitter = this._register(new Emitter<PositronDataToolLayout>);

	/**
	 * The onDidChangeColumnsWidthPercent event emitter.
	 */
	private readonly _onDidChangeColumnsWidthPercentEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidChangeColumnsScrollOffset event emitter.
	 */
	private readonly _onDidChangeColumnsScrollOffsetEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidChangeRowsScrollOffset event emitter.
	 */
	private readonly _onDidChangeRowsScrollOffsetEmitter = this._register(new Emitter<number>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param identifier The identifier.
	 */
	constructor(identifier: string) {
		// Call the base class's constructor.
		super();

		// Initialize.
		this._identifier = identifier;
		this._columns = [
			new PositronDataToolColumn(
				'17c76ec8-2d72-466a-a30a-ee395e7d53aa',
				{
					name: 'Column 1',
					type_name: 'number'
				}
			),
			new PositronDataToolColumn(
				'69004aa0-6a9e-46aa-b3da-bb58bdb64bcc',
				{
					name: 'Column 2',
					type_name: 'number'
				}
			),
			new PositronDataToolColumn(
				'9e221d4a-d9a2-43ac-b0fb-e2b876a28dff',
				{
					name: 'Column 3',
					type_name: 'number'
				}
			),
			new PositronDataToolColumn(
				'e0929c4c-4734-4698-86fc-52366fe4a315',
				{
					name: 'Column 4',
					type_name: 'number'
				}
			),
		];
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataToolInstance Implementation

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		return this._identifier;
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
	set layout(layout: PositronDataToolLayout) {
		if (layout !== this._layout) {
			this._layout = layout;
			this._onDidChangeLayoutEmitter.fire(this._layout);
		}
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
		if (columnsWidthPercent !== this._columnsWidthPercent) {
			this._columnsWidthPercent = columnsWidthPercent;
			this._onDidChangeColumnsWidthPercentEmitter.fire(this._columnsWidthPercent);
		}
	}


	/**
	 * Gets the columns.
	 */
	get columns() {
		return this._columns;
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
		if (columnsScrollOffset !== this._columnsScrollOffset) {
			this._columnsScrollOffset = columnsScrollOffset;
			this._onDidChangeColumnsScrollOffsetEmitter.fire(this._columnsScrollOffset);
		}
	}

	/**
	 * Gets the rows scroll offset.
	 */
	get rowsScrollOffset() {
		return this._rowsScrollOffset;
	}

	/**
	 * Sets the rows scroll offset.
	 */
	set rowsScrollOffset(rowsScrollOffset: number) {
		if (rowsScrollOffset !== this._rowsScrollOffset) {
			this._rowsScrollOffset = rowsScrollOffset;
			this._onDidChangeRowsScrollOffsetEmitter.fire(this._rowsScrollOffset);
		}
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
	 * onDidChangeRowsScrollOffset event.
	 */
	readonly onDidChangeRowsScrollOffset = this._onDidChangeRowsScrollOffsetEmitter.event;

	//#endregion IPositronDataToolInstance Implementation
}
