/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItem';

/**
 * ActivityItemOutput class.
 */
export class ActivityItemOutput extends ActivityItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param data The data.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		public readonly data: Record<string, string>) {
		super(id, parentId, when);
	}

	//#endregion Constructor
}
