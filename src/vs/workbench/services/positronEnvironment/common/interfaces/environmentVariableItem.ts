/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IEnvironmentVariableItem interface.
 */
export interface IEnvironmentVariableItem {
	/**
	 * Gets the identifier.
	 */
	id: string;

	/**
	 * Gets the path.
	 */
	path: string;

	/**
	 * Gets a value which indicates whether the environment variable has children.
	 */
	hasChildren: boolean;

	/**
	 * Gets the indent level.
	 */
	indentLevel: number;

	/**
	 * Gets the display name.
	 */
	displayName: string;

	/**
	 * Gets the display value.
	 */
	displayValue: string;

	/**
	 * Gets the display type.
	 */
	displayType: string;

	/**
	 * Gets a value which indicates whether the environment variable is expanded.
	 */
	expanded: boolean;
}
