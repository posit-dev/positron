/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';
import { IPositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolColumn';

/**
* PositronDataToolInstance class.
*/
export class PositronDataToolColumn extends Disposable implements IPositronDataToolColumn {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private readonly _identifier: string;

	/**
	 * Gets the column schema.
	 */
	private readonly _columnSchema: ColumnSchema;

	/**
	 * Gets or sets the column width.
	 */
	private _columnWidth: number;

	/**
	 * The onDidChangeColumnWidth event emitter.
	 */
	private readonly _onDidChangeColumnWidthEmitter = this._register(new Emitter<number>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param identifier The identifier of the column.
	 * @param columnSchema The column schema of the column.
	 */
	constructor(identifier: string, columnSchema: ColumnSchema) {
		// Call the base class's constructor.
		super();

		// Initialize.
		this._identifier = identifier;		// TODO: Should be part of ColumnSchema...
		this._columnSchema = columnSchema;

		// Initialize the column width (eventually, this will be set based on the column schema).
		this._columnWidth = 90;
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataToolColumn Implementation

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		return this._identifier;
	}

	/**
	 * Gets the column schema.
	 */
	get columnSchema() {
		return this._columnSchema;
	}

	/**
	 * Gets the column width.
	 */
	get columnWidth() {
		return this._columnWidth;
	}

	/**
	 * Sets the column width.
	 */
	set columnWidth(columnWidth: number) {
		if (columnWidth !== this._columnWidth) {
			this._columnWidth = columnWidth;
			this._onDidChangeColumnWidthEmitter.fire(this._columnWidth);
		}
	}

	/**
	 * onDidChangeColumnWidth event.
	 */
	readonly onDidChangeColumnWidth = this._onDidChangeColumnWidthEmitter.event;

	//#endregion IPositronDataToolColumn Implementation
}
