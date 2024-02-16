/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IDataCell } from 'vs/base/browser/ui/positronDataGrid/interfaces/dataCell';

/**
 * IDataRow interface.
 */
export interface IDataRow {
	/**
	 * Gets the cells.
	 */
	readonly cells: Map<number, IDataCell>;
}
