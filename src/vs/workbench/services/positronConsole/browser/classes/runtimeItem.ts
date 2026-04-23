/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RuntimeItem class.
 */
export abstract class RuntimeItem {
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 */
	constructor(readonly id: string) {
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Trim scrollback.
	 * @param scrollbackSize A number representing the scrollback size.
	 * @returns A number representing the remaining scrollback size.
	 */
	public abstract trimScrollback(scrollbackSize: number): number;

	/**
	 * Gets the clipboard representation of the runtime item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the runtime item.
	 */
	public agetClipboardRepresentation(commentPrefix: string): string[] {
		return [];
	}

	public abstract getClipboardRepresentation(commentPrefix: string): string[];

	//#endregion Public Methods
}
