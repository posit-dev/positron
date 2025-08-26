/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';

export interface IPositronNotebookCommandKeybinding {
	/** Primary keybinding */
	primary?: number;
	/** Secondary keybindings */
	secondary?: number[];
	/** Platform-specific keybindings for macOS */
	mac?: { primary: number; secondary?: number[]; };
	/** Platform-specific keybindings for Windows */
	win?: { primary: number; secondary?: number[]; };
	/** Platform-specific keybindings for Linux */
	linux?: { primary: number; secondary?: number[]; };
	/** Keybinding weight (defaults to KeybindingWeight.EditorContrib) */
	weight?: number;
	/** Context condition (defaults to POSITRON_NOTEBOOK_EDITOR_FOCUSED) */
	when?: ContextKeyExpression;
}
