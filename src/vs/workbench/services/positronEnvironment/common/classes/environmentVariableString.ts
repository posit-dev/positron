/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentVariable } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariable';

/**
 * EnvironmentVariableString class.
 */
export class EnvironmentVariableString extends EnvironmentVariable {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param name The name.
	 * @param value The value.
	 */
	constructor(id: string, name: string, readonly value: string) {
		// Call the base class's constructor.
		super(id, name);
	}

	//#endregion Constructor
}
