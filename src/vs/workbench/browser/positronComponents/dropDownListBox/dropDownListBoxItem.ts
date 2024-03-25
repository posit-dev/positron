/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * DropDownListBoxItemOptions interface.
 */
export interface DropDownListBoxItemOptions {
	readonly identifier: string;
	readonly title: string;
	readonly icon?: string;
	readonly disabled?: boolean;
}

/**
 * DropDownListBoxItem class.
 */
export class DropDownListBoxItem {
	/**
	 * Constructor.
	 * @param options A DropDownListBoxItemOptions that contains the down list box item options.
	 */
	constructor(readonly options: DropDownListBoxItemOptions) { }
}
