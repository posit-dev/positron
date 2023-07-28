/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'ansi-output';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemStartupFailure class.
 */
export class RuntimeItemStartupFailure extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	/**
	 * Gets the failure message.
	 */
	readonly message: string;

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param message The failure message.
	 * @param details The failure details or logs.
	 */
	constructor(
		id: string,
		message: string,
		details: string,
	) {
		// Call the base class's constructor.
		super(id);

		// Process the message directly into ANSI output lines. In the future, we
		// may want to do something more sophisticated here.
		this.message = message;
		this.outputLines = ANSIOutput.processOutput(details);
	}

	//#endregion Constructor
}
