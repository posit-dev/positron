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
	 * Gets the clipboard representation of the runtime item.
	 * @param commentPrefix The comment prefix to use.
	 * @note Override in derived classes to provide a clipboard representation.
	 * @returns The clipboard representation of the runtime item.
	 */
	public getClipboardRepresentation(commentPrefix: string): string[] {
		return [];
	}

	//#endregion Public Methods
}
