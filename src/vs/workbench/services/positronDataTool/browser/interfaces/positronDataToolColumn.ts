/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';
import { IDataColumn } from 'vs/base/browser/ui/dataGrid/interfaces/dataColumn';

/**
 * IPositronDataToolColumn interface.
 */
export interface IPositronDataToolColumn extends IDataColumn {
	/**
	 * Gets the column schema.
	 */
	readonly columnSchema: ColumnSchema;

	/**
	 * Gets or sets the width.
	 */
	width: number;

	/**
	 * Gets or sets the layout width.
	 */
	layoutWidth: number;
}
