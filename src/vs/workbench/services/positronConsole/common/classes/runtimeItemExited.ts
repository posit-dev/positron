/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'ansi-output';
import { RuntimeExitReason } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemExited class.
 */
export class RuntimeItemExited extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param reason The exit reason.
	 * @param languageName The name of the language that exited.
	 * @param message A message to display.
	 * @param onRestartRequested A optional callback to invoke when a restart is requested.
	 */
	constructor(id: string,
		readonly reason: RuntimeExitReason,
		readonly languageName: string,
		message: string,
		readonly onRestartRequested?: () => void) {
		// Call the base class's constructor.
		super(id);

		// Process the message directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(message);
	}

	//#endregion Constructor
}
