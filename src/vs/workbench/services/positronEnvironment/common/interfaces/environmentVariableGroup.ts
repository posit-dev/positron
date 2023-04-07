/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IEnvironmentVariableGroup interface.
 */
export interface IEnvironmentVariableGroup {
	/**
	 * Gets the identifier.
	 */
	readonly id: string;

	/**
	 * Gets the title.
	 */
	readonly title: string;

	/**
	 * Gets a value which indicates whether the environment variable group is expanded.
	 */
	readonly expanded: boolean;
}
