/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDataColumn } from '../../../../browser/positronDataGrid/interfaces/dataColumn.js';
import { ColumnSchema } from '../../../languageRuntime/common/positronDataExplorerComm.js';

/**
 * IPositronDataExplorerColumn interface.
 */
export interface IPositronDataExplorerColumn extends IDataColumn {
	/**
	 * Gets the column schema.
	 */
	readonly columnSchema: ColumnSchema;
}
