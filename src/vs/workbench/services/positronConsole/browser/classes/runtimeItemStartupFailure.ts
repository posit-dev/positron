/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem.js';

/**
 * RuntimeItemStartupFailure class.
 */
export class RuntimeItemStartupFailure extends RuntimeItemStandard {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param message The failure message.
	 * @param details The failure details or logs.
	 */
	constructor(
		id: string,
		readonly message: string,
		details: string,
	) {
		// Call the base class's constructor.
		super(id, details);
	}

	//#endregion Constructor
}
