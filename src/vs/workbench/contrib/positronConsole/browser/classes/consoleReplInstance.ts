/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/positronConsole';

/**
 * ConsoleReplInstance class.
 */
export class ConsoleReplInstance {
	/**
	 * Constructor.
	 * @param positronConsoleInstance The IPositronConsoleInstance for the console.
	 */
	constructor(readonly positronConsoleInstance: IPositronConsoleInstance) {
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		// TODO@softwarenerd - Temporary code because R's metadata returns 'r' for the language and something like
		// 'R: /Library/Frameworks/R.framework/Resources' for the name.
		if (this.positronConsoleInstance.runtime.metadata.name.startsWith('R')) {
			return 'R';
		} else {
			return this.positronConsoleInstance.runtime.metadata.name;
		}
	}
}
