/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * ComboBoxMenuItemOptions interface.
 */
export interface ComboBoxMenuItemOptions {
	readonly identifier: string;
	readonly label: string;
	readonly icon?: string;
	readonly disabled?: boolean;
}

/**
 * ComboBoxMenuItem class.
 */
export class ComboBoxMenuItem {
	/**
	 * Constructor.
	 * @param options A ComboBoxMenuItemOptions that contains the combo box item options.
	 */
	constructor(readonly options: ComboBoxMenuItemOptions) { }
}
