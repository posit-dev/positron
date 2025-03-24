/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem.js';
import { RuntimeExitReason } from '../../../languageRuntime/common/languageRuntimeService.js';

/**
 * RuntimeItemExited class.
 */
export class RuntimeItemExited extends RuntimeItemStandard {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param reason The exit reason.
	 * @param message A message to display.
	 */
	constructor(
		id: string,
		readonly reason: RuntimeExitReason,
		message: string
	) {
		// Call the base class's constructor.
		super(id, message);
	}

	//#endregion Constructor
}
