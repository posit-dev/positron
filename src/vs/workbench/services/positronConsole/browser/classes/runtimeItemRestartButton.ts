/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from './runtimeItem.js';

/**
 * RuntimeItemRestartButton class.
 */
export class RuntimeItemRestartButton extends RuntimeItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param languageName The language name.
	 * @param onRestartRequested A callback to invoke when a restart is requested.
	 */
	constructor(
		id: string,
		readonly languageName: string,
		readonly onRestartRequested: () => void
	) {
		super(id);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Trim scrollback.
	 * @param scrollbackSize A number representing the scrollback size.
	 * @returns A number representing the remaining scrollback size.
	 */
	public override trimScrollback(scrollbackSize: number): number {
		// We should never be called with a scrollback size <= 0.
		if (scrollbackSize <= 0) {
			return 0;
		}

		// Counts as one scrollback item.
		return scrollbackSize - 1;
	}

	/**
	 * Gets the clipboard representation of the runtime item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the runtime item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return [];
	}

	//#endregion Public Methods
}
