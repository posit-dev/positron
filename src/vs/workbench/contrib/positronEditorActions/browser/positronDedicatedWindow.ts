/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow } from '../../../../base/browser/dom.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { IAuxiliaryWindowOpenOptions } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';

/**
 * The single definition of the "dedicated window" look: native OS title bar,
 * compact chrome, sized to (and opening over) the window the editor leaves.
 * `extraTraits` may add traits but never replace the shape -- the dedicated
 * look wins.
 */
export function dedicatedWindowOptions(sourceWindow: Window, extraTraits?: IAuxiliaryWindowOpenOptions): IAuxiliaryWindowOpenOptions {
	return {
		...extraTraits,
		compact: true,
		nativeTitlebar: true,
		bounds: { width: sourceWindow.outerWidth, height: sourceWindow.outerHeight }
	};
}

/**
 * Moves the active editor into a dedicated window. Not in the palette;
 * callers invoke it by id after making the editor to move the active one,
 * the same contract as `workbench.action.moveEditorToNewWindow`.
 */
CommandsRegistry.registerCommand('positron.editor.moveIntoDedicatedWindow', async (accessor: ServicesAccessor) => {
	const editorGroupsService = accessor.get(IEditorGroupsService);

	const sourceGroup = editorGroupsService.activeGroup;
	const editor = sourceGroup.activeEditor;
	if (!editor) {
		return; // nothing to move; do not open an empty window
	}

	// The source window is still the active window at this point.
	const auxiliaryEditorPart = await editorGroupsService.createAuxiliaryEditorPart(dedicatedWindowOptions(getActiveWindow()));
	sourceGroup.moveEditors(prepareMoveCopyEditors(sourceGroup, [editor]), auxiliaryEditorPart.activeGroup);
	auxiliaryEditorPart.activeGroup.focus();
});
