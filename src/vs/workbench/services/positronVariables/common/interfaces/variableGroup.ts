/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IVariableGroup interface.
 */
export interface IVariableGroup {
	/**
	 * Gets the identifier.
	 */
	readonly id: string;

	/**
	 * Gets the title.
	 */
	readonly title: string;

	/**
	 * Gets a value which indicates whether the variable group is expanded.
	 */
	readonly expanded: boolean;
}
