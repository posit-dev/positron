/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IDataColumn } from 'vs/base/browser/ui/positronDataGrid/interfaces/dataColumn';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * IPositronDataExplorerColumn interface.
 */
export interface IPositronDataExplorerColumn extends IDataColumn {
	/**
	 * Gets the column schema.
	 */
	readonly columnSchema: ColumnSchema;
}
