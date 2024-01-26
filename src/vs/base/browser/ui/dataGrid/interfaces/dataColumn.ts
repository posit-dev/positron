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
	 * Gets the identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets the codicon.
	 */
	readonly codicon?: string;

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

	/**
	 * Gets or sets the width.
	 */
	width: number;

	/**
	 * Gets or sets the layout width.
	 */
	layoutWidth: number;
}
