/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentItem';
import { IEnvironmentVariable } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';

/**
 * EnvironmentItem class.
 */
export class EnvironmentItemVariable extends EnvironmentItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param name The environment variable.
	 */
	constructor(id: string, readonly environmentVariable: IEnvironmentVariable) {
		super(id);
	}

	//#endregion Constructor
}
