/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConsoleErrorSuggestion } from '../../common/consoleErrorFollowup.js';
import { ActivityItem, TrimScrollbackResult } from './activityItem.js';

/**
 * ActivityItemErrorSuggestion class.
 *
 * Rendered beneath an {@link ActivityItemErrorMessage} (in the same activity
 * group) when a console-error followup provider offers one or more actions,
 * such as installing a missing package.
 */
export class ActivityItemErrorSuggestion extends ActivityItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier (the same parent as the error, so
	 *   the suggestion renders in the same activity group).
	 * @param when The date.
	 * @param suggestions The follow-up suggestions to render.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly suggestions: IConsoleErrorSuggestion[]
	) {
		super(id, parentId, when);
	}

	//#endregion Constructor

	//#region Public Methods

	public override trimScrollback(scrollbackSize: number): TrimScrollbackResult {
		if (scrollbackSize <= 0) {
			return { trimmed: false, remainingScrollbackSize: 0 };
		}
		// Counts as one scrollback item; nothing is trimmed in place.
		return { trimmed: false, remainingScrollbackSize: scrollbackSize - 1 };
	}

	public override getClipboardRepresentation(_commentPrefix: string): string[] {
		// Suggestions are interactive links, not console text; nothing to copy.
		return [];
	}

	//#endregion Public Methods
}
