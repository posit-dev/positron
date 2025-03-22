/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem.js';

/**
 * RuntimeItemTrace class.
 */
export class RuntimeItemTrace extends RuntimeItemStandard {
	//#region Public Properties

	/**
	 * Gets the timestamp.
	 */
	readonly timestamp = new Date();

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param text The text.
	 */
	constructor(id: string, text: string) {
		// Replace ESC and CSI with text so ANSI escape sequences are not regognized.
		text = text.replaceAll('\x1b', 'ESC');
		text = text.replaceAll('\x9B', 'CSI');

		// Call the base class's constructor.
		super(id, text);
	}

	//#endregion Constructor
}
