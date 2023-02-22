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
		public readonly id: string,
		public readonly parentId: string,
		public readonly when: Date) {
	}

	//#endregion Constructor
}
