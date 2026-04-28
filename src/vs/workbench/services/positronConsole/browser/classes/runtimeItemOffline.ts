/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItemStandard.js';

/**
 * RuntimeItemOffline class.
 */
export class RuntimeItemOffline extends RuntimeItemStandard {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param message The message.
	 */
	constructor(id: string, message: string) {
		// Call the base class's constructor.
		super(id, message);
	}

	//#endregion Constructor
}
