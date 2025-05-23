/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';

/**
 * Represents an empty output by a language runtime.
 */
export class ActivityItemOutputEmpty extends ActivityItem {
	//#region Constructor

	/**
	 * Constructor.
	 *
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param outputId The optional identifier of the output associated with this activity item.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly outputId?: string
	) {
		// Call the base class's constructor.
		super(id, parentId, when);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return [];
	}

	//#endregion Public Methods
}

