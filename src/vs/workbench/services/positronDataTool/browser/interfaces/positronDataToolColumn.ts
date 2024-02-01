/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IDataColumn } from 'vs/base/browser/ui/dataGrid/interfaces/dataColumn';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';

/**
 * IPositronDataToolColumn interface.
 */
export interface IPositronDataToolColumn extends IDataColumn {
	/**
	 * Gets the column schema.
	 */
	readonly columnSchema: ColumnSchema;
}
