/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';
import { OutputLine, outputLineSplitter } from 'vs/workbench/services/positronConsole/common/classes/outputLine';

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the code output lines.
	 */
	public readonly codeOutputLines: readonly OutputLine[];

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
		this.codeOutputLines = outputLineSplitter(code);
	}

	//#endregion Constructor
}
