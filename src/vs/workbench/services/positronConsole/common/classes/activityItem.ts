/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * ActivityItem class.
 */
export class ActivityItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date
	) {
	}

	//#endregion Constructor
}
