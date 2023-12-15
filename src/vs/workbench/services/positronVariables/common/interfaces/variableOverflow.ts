/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IVariableOverflow interface.
 */
export interface IVariableOverflow {
	/**
	 * Gets the identifier.
	 */
	readonly id: string;

	/**
	 * Gets the indent level.
	 */
	readonly indentLevel: number;

	/**
	 * Gets the overflow values.
	 */
	readonly overflowValues: number;
}
