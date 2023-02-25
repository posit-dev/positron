/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';
import { OutputLine, outputLineSplitter } from 'vs/workbench/services/positronConsole/common/classes/outputLine';

/**
 * ActivityItemError class.
 */
export class ActivityItemError extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the message output lines.
	 */
	public readonly messageOutputLines: readonly OutputLine[];

	/**
	 * Gets the traceback output lines.
	 */
	public readonly tracebackOutputLines: readonly OutputLine[];

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
		public readonly traceback: string[]) {
		super(id, parentId, when);
		this.messageOutputLines = outputLineSplitter(message);
		this.tracebackOutputLines = outputLineSplitter(traceback);
	}

	//#endregion Constructor
}
