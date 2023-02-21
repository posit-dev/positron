/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';

/**
 * ActivityItemError class.
 */
export class ActivityItemError extends ActivityItem {
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
	}

	//#endregion Constructor
}
