/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Line, lineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ActivityItem } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItem';

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput extends ActivityItem {
	//#region Public Properties

	public readonly lines: readonly Line[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param code The code.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		public readonly code: string) {
		super(id, parentId, when);
		this.lines = lineSplitter(code);
	}

	//#endregion Constructor
}
