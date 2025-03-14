/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataColumnAlignment } from '../../../browser/positronDataGrid/interfaces/dataColumn.js';
import { ColumnSchema, ColumnDisplayType } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { IPositronDataExplorerColumn } from './interfaces/positronDataExplorerColumn.js';

/**
 * PositronDataExplorerColumn class.
 */
export class PositronDataExplorerColumn implements IPositronDataExplorerColumn {
	//#region Private Properties

	/**
	 * Gets the column schema.
	 */
	private readonly _columnSchema: ColumnSchema;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param columnSchema The column schema of the column.
	 */
	constructor(columnSchema: ColumnSchema) {
		// Initialize.
		this._columnSchema = columnSchema;
	}

	//#endregion Constructor

	//#region IPositronDataExplorerColumn Implementation

	/**
	 * Gets the column schema.
	 */
	get columnSchema() {
		return this._columnSchema;
	}

	//#endregion IPositronDataExplorerColumn Implementation

	//#region IDataColumn Implementation

	/**
	 * Gets the name.
	 */
	get name() {
		return this._columnSchema.column_name;
	}

	/**
	 * Gets the description.
	 */
	get description() {
		return this._columnSchema.type_name;
	}

	/**
	 * Gets the alignment.
	 */
	get alignment() {
		// Determine the alignment based on type.
		switch (this.columnSchema.type_display) {
			case ColumnDisplayType.Number:
				return DataColumnAlignment.Right;

			case ColumnDisplayType.Boolean:
				return DataColumnAlignment.Left;

			case ColumnDisplayType.String:
				return DataColumnAlignment.Left;

			case ColumnDisplayType.Date:
				return DataColumnAlignment.Right;

			case ColumnDisplayType.Datetime:
				return DataColumnAlignment.Right;

			case ColumnDisplayType.Time:
				return DataColumnAlignment.Right;

			case ColumnDisplayType.Interval:
				return DataColumnAlignment.Right;

			case ColumnDisplayType.Object:
				return DataColumnAlignment.Left;

			case ColumnDisplayType.Array:
				return DataColumnAlignment.Left;

			case ColumnDisplayType.Struct:
				return DataColumnAlignment.Left;

			case ColumnDisplayType.Unknown:
				return DataColumnAlignment.Left;
		}
	}

	//#endregion IDataColumn Implementation
}
