/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * ComboBoxItemOptions interface.
 */
export interface ComboBoxItemOptions {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	readonly disabled?: boolean;
}

/**
 * ComboBoxItem class.
 */
export class ComboBoxItem {
	/**
	 * Constructor.
	 * @param options A ComboBoxItemOptions that contains the combo box item options.
	 */
	constructor(readonly options: ComboBoxItemOptions) {
	}
}
