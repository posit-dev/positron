/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';

/**
 * Represents formatted HTML output by a language runtime.
 */
export class ActivityItemOutputHtml extends ActivityItem {
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
		id: string,
		parentId: string,
		when: Date,
		readonly html: string
	) {
		// Call the base class's constructor.
		super(id, parentId, when);
	}

	//#endregion Constructor
}
