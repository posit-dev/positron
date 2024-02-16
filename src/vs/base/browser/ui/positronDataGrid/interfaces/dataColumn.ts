/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
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

	/**
	 * Gets the alignment.
	 */
	readonly alignment: DataColumnAlignment;
}
