/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DataColumnAlignment enumeration.
 */
export enum DataColumnAlignment {
	Left = 'left',
	Center = 'center',
	Right = 'right'
}

/**
 * IDataColumn interface.
 */
export interface IDataColumn {
	/**
	 * Gets the name.
	 */
	readonly name?: string;

	/**
	 * Gets the description.
	 */
	readonly description?: string;
}
