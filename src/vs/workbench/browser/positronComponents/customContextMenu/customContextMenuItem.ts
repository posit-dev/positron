/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardModifiers } from '../../../../base/browser/ui/positronComponents/button/positronButton.js';

/**
 * CustomContextMenuItemOptions interface.
 */
export interface CustomContextMenuItemOptions {
	readonly commandId?: string;
	/**
	 * Called BEFORE the command executes. Similar to native ActionRunner's onWillRun.
	 */
	readonly onWillSelect?: () => void;
	readonly checked?: boolean;
	readonly icon?: string;
	readonly label: string;
	readonly disabled?: boolean;
	/**
	 * Called AFTER the command executes (or immediately if no commandId).
	 * Similar to native ActionRunner's onDidRun.
	 */
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
