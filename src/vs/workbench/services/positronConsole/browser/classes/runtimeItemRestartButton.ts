/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from './runtimeItem.js';

/**
 * RuntimeItemRestartButton class.
 */
export class RuntimeItemRestartButton extends RuntimeItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param languageName The language name.
	 * @param onRestartRequested A callback to invoke when a restart is requested.
	 */
	constructor(
		id: string,
		readonly languageName: string,
		readonly onRestartRequested: () => void
	) {
		super(id);
	}

	//#endregion Constructor
}
