/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';

/**
 * ActivityItemError class.
 */
export class ActivityItemError extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the message output lines.
	 */
	public readonly messageOutputLines: readonly ANSIOutputLine[];

	/**
	 * Gets the traceback output lines.
	 */
	public readonly tracebackOutputLines: readonly ANSIOutputLine[];

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
		id: string,
		parentId: string,
		when: Date,
		public readonly name: string,
		public readonly message: string,
		public readonly traceback: string[]
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Process the message and traceback directly into ANSI output lines suitable for rendering.
		this.messageOutputLines = ANSIOutput.processOutput(message);
		this.tracebackOutputLines = ANSIOutput.processOutput(traceback.join('\n'));
	}

	//#endregion Constructor
}
