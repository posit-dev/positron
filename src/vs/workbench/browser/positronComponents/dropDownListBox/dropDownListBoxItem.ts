/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * DropDownListBoxItemOptions interface.
 */
export interface DropDownListBoxItemOptions<T extends NonNullable<any>, V> {
	readonly identifier: T;
	readonly title?: string;
	readonly icon?: string;
	readonly disabled?: boolean;
	value?: V;
}

/**
 * DropDownListBoxItem class.
 */
export class DropDownListBoxItem<T extends NonNullable<any>, V> {
	/**
	 * Constructor.
	 * @param options A DropDownListBoxItemOptions that contains the down list box item options.
	 */
	constructor(readonly options: DropDownListBoxItemOptions<T, V>) { }
}
