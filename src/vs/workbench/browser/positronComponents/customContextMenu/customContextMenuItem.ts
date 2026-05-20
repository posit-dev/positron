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
 * CustomContextMenuItemOptions type.
 */
export type CustomContextMenuItemOptions = CustomContextMenuItemIconOptions & {
	readonly commandId?: string;
	/**
	 * Called BEFORE the command executes. Similar to native ActionRunner's onWillRun.
	 */
	readonly onWillSelect?: () => void;
	readonly checked?: boolean;
	readonly label: string;
	readonly disabled?: boolean;
	/**
	 * Indicates that selecting this item performs a destructive action (e.g. delete). The
	 * renderer styles the label using the error foreground color.
	 */
	readonly destructive?: boolean;
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
