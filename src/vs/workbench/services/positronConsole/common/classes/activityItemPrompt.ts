/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * ActivityItemPrompt class.
 */
export class ActivityItemPrompt {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param prompt The prompt.
	 * @param password A value which indicates whether this is a password prompt (and typing should be hidden).
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly prompt: string,
		readonly password: boolean
	) {
	}

	//#endregion Constructor
}
