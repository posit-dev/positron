/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ActivityItem class.
 */
export abstract class ActivityItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date and time when the activity item occurred.
	 */
	constructor(readonly id: string, readonly parentId: string, readonly when: Date) {
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public abstract getClipboardRepresentation(commentPrefix: string): string[];

	//#endregion Public Methods
}
