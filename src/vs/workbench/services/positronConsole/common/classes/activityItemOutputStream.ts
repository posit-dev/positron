/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * ActivityItemOutputStream class.
 */
export class ActivityItemOutputStream {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param text The text.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly text: string
	) {
	}

	//#endregion Constructor
}
