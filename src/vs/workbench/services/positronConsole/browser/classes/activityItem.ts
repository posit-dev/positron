/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ActivityItem class.
 */
export abstract class ActivityItem {
	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether the item is hidden.
	 */
	private _isHidden = false;

	//#endregion Private Properties

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

	//#region Public Properties

	/**
	 * Gets a value which indicates whether the item is hidden.
	 */
	public get isHidden(): boolean {
		return this._isHidden;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public abstract getClipboardRepresentation(commentPrefix: string): string[];

	/**
	 * Optimizes scrollback. This is the default implementation which treats an activity item
	 * as a single item, so it is either entirely visible or entirely hidden.
	 * @param scrollbackSize The scrollback size.
	 * @returns The remaining scrollback size.
	 */
	public optimizeScrollback(scrollbackSize: number): number {
		// If scrollback size is zero, hide the item and return zero.
		if (!scrollbackSize) {
			this._isHidden = true;
			return 0;
		}

		// Unhide the item and return the scrollback size minus one.
		this._isHidden = false;
		return scrollbackSize - 1;
	}

	//#endregion Public Methods
}
