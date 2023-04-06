/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IEnvironmentVariableItem interface.
 */
export interface IEnvironmentVariableItem {
	/**
	 *
	 */
	hasChildren: boolean;
	displayName: string;
	displayValue: string;
	displayType: string;

	/**
	 * Gets a value which indicates whether the environment variable is expanded.
	 */
	expanded: boolean;
}
