/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the code output lines.
	 */
	public readonly codeOutputLines: readonly ANSIOutputLine[];

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
		this.codeOutputLines = ANSIOutput.processOutput(code);
	}

	//#endregion Constructor
}
