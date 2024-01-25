/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IDataColumn interface.
 */
export interface IDataColumn {
	/**
	 * Gets the identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets the name.
	 */
	readonly name: string;

	/**
	 * Gets or sets the width.
	 */
	width: number;

	/**
	 * Gets or sets the layout width.
	 */
	layoutWidth: number;
}
