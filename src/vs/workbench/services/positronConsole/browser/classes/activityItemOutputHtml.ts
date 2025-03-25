/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { ActivityItem } from './activityItem.js';

/**
 * Localized strings.
 */
const positronHTMLOutput = localize('positronHTMLOutput', "[HTML output]");

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
	 * @param text The text content returned from the runtime.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly html: string,
		readonly text: string,
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
		return [commentPrefix + (this.text ?? positronHTMLOutput)];
	}

	//#endregion Public Methods
}
