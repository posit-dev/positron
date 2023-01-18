/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IReplInstance } from 'vs/workbench/contrib/repl/common/repl';

/**
 * ConsoleReplInstance class.
 */
export class ConsoleReplInstance {
	/**
	 * Constructor.
	 * @param replInstance The IReplInstance for the console REPL instance.
	 */
	constructor(readonly replInstance: IReplInstance) {
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		// TODO@softwarenerd - Temporary code because R's metadata returns 'r' for the language and something like
		// 'R: /Library/Frameworks/R.framework/Resources' for the name.
		if (this.replInstance.runtime.metadata.name.startsWith('R')) {
			return 'R';
		} else {
			return this.replInstance.runtime.metadata.name;
		}
	}
}
