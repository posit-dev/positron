/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem.js';

/**
 * RuntimeItemPendingInput class.
 */
export class RuntimeItemPendingInput extends RuntimeItemStandard {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param inputPrompt The input prompt.
	 * @param executionId The execution identifier for the code.
	 * @param code The code.
	 */
	constructor(
		id: string,
		readonly inputPrompt: string,
		readonly executionId: string | undefined,
		readonly code: string
	) {
		// Call the base class's constructor.
		super(id, code);
	}

	//#endregion Constructor
}
