/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ScrollbackStrategy } from '../positronConsoleService.js';

/**
 * ActivityItemStream class.
 */
export class ActivityItem {
	//#region Public Properties

	/**
	 * Gets or sets a value which indicates whether the item is hidden.
	 */
	public isHidden = false;

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 */
	constructor(readonly id: string, readonly parentId: string, readonly when: Date) {
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @param scrollbackStrategy The scrollback strategy.
	 * @returns The remaining scrollback size.
	 */
	public optimizeScrollback(scrollbackSize: number, scrollbackStrategy: ScrollbackStrategy) {
		// If scrollback size is zero, hide the item and return zero.
		if (!scrollbackSize) {
			this.isHidden = true;
			return 0;
		}

		// Unhide the item and return the scrollback size minus one.
		this.isHidden = false;
		return scrollbackSize - 1;
	}

	//#endregion Public Methods
}
