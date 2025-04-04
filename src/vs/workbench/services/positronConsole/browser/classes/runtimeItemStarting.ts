/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem.js';
import { SessionAttachMode } from '../interfaces/positronConsoleService.js';

/**
 * RuntimeItemStarting class.
 */
export class RuntimeItemStarting extends RuntimeItemStandard {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param message The message.
	 * @param attachMode The attach mode.
	 */
	constructor(id: string, message: string, public attachMode: SessionAttachMode) {
		// Call the base class's constructor.
		super(id, message);
	}

	//#endregion Constructor
}
