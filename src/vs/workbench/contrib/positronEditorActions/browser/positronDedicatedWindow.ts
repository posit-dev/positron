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
 * What a "dedicated window" is: an auxiliary window with a native OS title bar
 * and compact chrome (no editor tabs, no status bar, no custom titlebar row),
 * sized to match the window the editor moves out of and opening exactly over
 * it.
 *
 * This is the single definition of the look, shared with anything else that
 * needs one, so callers state their intent rather than assembling auxiliary
 * window options.
 *
 * @param sourceWindow the window the editor is leaving; supplies the size.
 * @param extraTraits traits a specific kind of dedicated window needs on top
 * of the shared shape. They cannot replace the shape itself: the dedicated
 * look wins so this stays the single definition of it.
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
 * Moves the active editor into a dedicated window.
 *
 * The command is intent-level on purpose: what a dedicated window looks like
 * is policy owned here, so callers never learn about auxiliary window options.
 * It is not exposed in the command palette; callers invoke it by id after
 * making the editor to move the active one -- the same contract as
 * `workbench.action.moveEditorToNewWindow`.
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
