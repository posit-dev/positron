/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItem';

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
	constructor(id: string,
		readonly languageName: string,
		readonly onRestartRequested: () => void) {
		super(id);
	}

	//#endregion Constructor
}
