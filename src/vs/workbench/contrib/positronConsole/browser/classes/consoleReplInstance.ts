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
		return this.replInstance.runtime.metadata.languageName;
	}
}
