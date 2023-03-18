/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentVariable } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';

/**
 * EnvironmentItem class.
 */
export class EnvironmentItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param name The environment variable.
	 */
	constructor(readonly id: string, readonly environmentVariable: IEnvironmentVariable) {
	}

	//#endregion Constructor
}
