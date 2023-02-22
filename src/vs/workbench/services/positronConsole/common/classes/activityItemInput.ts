/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Line, lineSplitter } from 'vs/workbench/services/positronConsole/common/classes/utils';
import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the code lines.
	 */
	public readonly codeLines: readonly Line[];

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
		this.codeLines = lineSplitter(code);
	}

	//#endregion Constructor
}
