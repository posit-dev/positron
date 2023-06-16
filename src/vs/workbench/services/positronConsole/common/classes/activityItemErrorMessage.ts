/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';

/**
 * ActivityItemErrorMessage class.
 */
export class ActivityItemErrorMessage {
	//#region Public Properties

	/**
	 * Gets the message output lines.
	 */
	readonly messageOutputLines: readonly ANSIOutputLine[];

	/**
	 * Gets the traceback output lines.
	 */
	readonly tracebackOutputLines: readonly ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param name The name of the error.
	 * @param message The error message.
	 * @param traceback The error traceback.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly name: string,
		readonly message: string,
		readonly traceback: string[]
	) {
		// Process the message and traceback directly into ANSI output lines suitable for rendering.
		this.messageOutputLines = ANSIOutput.processOutput(message);
		this.tracebackOutputLines = !traceback.length ?
			[] :
			ANSIOutput.processOutput(traceback.join('\n'));
	}

	//#endregion Constructor
}
