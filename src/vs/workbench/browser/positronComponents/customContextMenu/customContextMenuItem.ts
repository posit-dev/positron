/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardModifiers } from '../../../../base/browser/ui/positronComponents/button/positronButton.js';

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
