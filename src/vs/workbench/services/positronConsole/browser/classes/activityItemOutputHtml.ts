/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents formatted HTML output by a language runtime.
 */
export class ActivityItemOutputHtml {
	//#region Constructor

	/**
	 * Constructor.
	 *
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param html The HTML content returned from the runtime.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly html: string
	) {
	}

	//#endregion Constructor
}
