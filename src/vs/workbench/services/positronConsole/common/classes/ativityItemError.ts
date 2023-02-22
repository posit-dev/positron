/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Line, lineSplitter } from 'vs/workbench/services/positronConsole/common/classes/utils';
import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';

/**
 * ActivityItemError class.
 */
export class ActivityItemError extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the message lines.
	 */
	public readonly messageLines: readonly Line[];

	/**
	 * Gets the traceback lines.
	 */
	public readonly tracebackLines: readonly Line[];

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
		this.messageLines = lineSplitter(message);
		this.tracebackLines = lineSplitter(traceback);
	}

	//#endregion Constructor
}
