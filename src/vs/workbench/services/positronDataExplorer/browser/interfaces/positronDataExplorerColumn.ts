/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDataColumn } from 'vs/workbench/browser/positronDataGrid/interfaces/dataColumn';
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
