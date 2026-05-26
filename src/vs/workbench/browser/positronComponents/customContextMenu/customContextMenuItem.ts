/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardModifiers } from '../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * Icon options. A menu item may specify either a codicon name (`icon`) or an image source
 * (`iconSrc`), but not both. Defined as a discriminated union so callers can't accidentally
 * set both fields.
 */
type CustomContextMenuItemIconOptions =
	| { readonly icon?: string; readonly iconSrc?: never }
	| { readonly icon?: never; readonly iconSrc?: string };

/**
 * Behavior options. A menu item may either represent a toggleable state (`checked`) or a
 * destructive action (`destructive`), but not both. A "checked destructive" item has no
 * coherent meaning -- you don't toggle a delete on and off. Defined as a discriminated
 * union so callers can't accidentally set both fields.
 */
type CustomContextMenuItemBehaviorOptions =
	| { readonly checked?: boolean; readonly destructive?: never }
	| { readonly checked?: never; readonly destructive?: boolean };

/**
 * CustomContextMenuItemOptions type.
 */
export type CustomContextMenuItemOptions = CustomContextMenuItemIconOptions & CustomContextMenuItemBehaviorOptions & {
	readonly commandId?: string;
	/**
	 * Called BEFORE the command executes. Similar to native ActionRunner's onWillRun.
	 */
	readonly onWillSelect?: () => void;
	readonly label: string;
	readonly disabled?: boolean;
	/**
	 * Called AFTER the command executes (or immediately if no commandId).
	 * Similar to native ActionRunner's onDidRun.
	 */
	readonly onSelected: (e: KeyboardModifiers) => void;
};

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
