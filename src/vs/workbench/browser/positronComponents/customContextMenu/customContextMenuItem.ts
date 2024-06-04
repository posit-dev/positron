/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardModifiers } from 'vs/base/browser/ui/positronComponents/button/positronButton';

/**
 * CustomContextMenuItemOptions interface.
 */
export interface CustomContextMenuItemOptions {
	readonly commandId?: string;
	readonly checked?: boolean;
	readonly icon?: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly onSelected: (e: KeyboardModifiers) => void;
}

/**
 * CustomContextMenuItem class.
 */
export class CustomContextMenuItem {
	/**
	 * Constructor.
	 * @param options A ContextMenuItemOptions that contains the context menu item options.
	 */
	constructor(readonly options: CustomContextMenuItemOptions) {
	}
}
