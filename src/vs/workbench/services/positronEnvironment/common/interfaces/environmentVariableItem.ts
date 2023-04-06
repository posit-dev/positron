/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IEnvironmentVariableItem interface.
 */
export interface IEnvironmentVariableItem {
	hasChildren: boolean;
	displayName: string;
	displayValue: string;
	displayType: string;
	expanded: boolean;
}
