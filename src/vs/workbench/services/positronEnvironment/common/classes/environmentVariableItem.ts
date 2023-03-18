/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { IEnvironmentVariable } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';

/**
 * EnvironmentVariableItem class.
 */
export class EnvironmentVariableItem {
	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	readonly id = generateUuid();

	//#region Constructor

	/**
	 * Constructor.
	 * @param name The environment variable.
	 */
	constructor(readonly environmentVariable: IEnvironmentVariable) {
	}

	//#endregion Constructor
}
