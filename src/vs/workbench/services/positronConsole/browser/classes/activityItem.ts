/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TrimScrollbackResult interface.
 */
export interface TrimScrollbackResult {
	// A value which indicates whether the item actually trimmed any content.
	readonly trimmed: boolean;

	// The remaining scrollback size after trimming this item.
	readonly remainingScrollbackSize: number;
}

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
	 * Trim scrollback.
	 * @param scrollbackSize A number representing the scrollback size.
	 * @returns A TrimScrollbackResult indicating the result of the trim scrollback operation.
	 */
	public abstract trimScrollback(scrollbackSize: number): TrimScrollbackResult;

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public abstract getClipboardRepresentation(commentPrefix: string): string[];

	//#endregion Public Methods
}
