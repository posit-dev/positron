/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardModifiers } from 'vs/base/browser/ui/positronComponents/positronButton';

/**
 * ContextMenuItemOptions interface.
 */
export interface ContextMenuItemOptions {
	readonly checked?: boolean;
	readonly label: string;
	readonly icon?: string;
	readonly disabled?: boolean;
	readonly onSelected: (e: KeyboardModifiers) => void;
}

/**
 * ContextMenuItem class.
 */
export class ContextMenuItem {
	/**
	 * Constructor.
	 * @param options A ContextMenuItemOptions that contains the context menu item options.
	 */
	constructor(readonly options: ContextMenuItemOptions) {
	}
}
