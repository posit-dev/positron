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
 * Moves the active editor into a "dedicated window": an auxiliary window with
 * a native OS title bar and compact chrome (no editor tabs, no status bar),
 * sized to match the window the editor moves out of.
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

	// Size the dedicated window like the source window, which is still the
	// active window at this point; it intentionally opens exactly over it.
	const sourceWindow = getActiveWindow();
	const options: IAuxiliaryWindowOpenOptions = {
		compact: true,
		nativeTitlebar: true,
		bounds: { width: sourceWindow.outerWidth, height: sourceWindow.outerHeight }
	};

	const auxiliaryEditorPart = await editorGroupsService.createAuxiliaryEditorPart(options);
	sourceGroup.moveEditors(prepareMoveCopyEditors(sourceGroup, [editor]), auxiliaryEditorPart.activeGroup);
	auxiliaryEditorPart.activeGroup.focus();
});
