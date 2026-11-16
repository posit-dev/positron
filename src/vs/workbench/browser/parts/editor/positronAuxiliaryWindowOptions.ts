/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAuxiliaryWindowOpenOptions } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

/**
 * Webview view type of a Posit Assistant chat tab. Cross-repo contract: the Assistant registers
 * its panel under this name, so renaming it on either side silently gives Assistant tabs a normal
 * window again.
 */
const ASSISTANT_WEBVIEW_VIEW_TYPE = 'posit-assistant';

/**
 * Webview view type of a Posit Assistant window panel: an Assistant editor that shows its own
 * conversation tabs and lives in a dedicated Assistant window. Cross-repo contract, like the
 * view type above.
 */
const ASSISTANT_WINDOW_VIEW_TYPE = 'posit-assistant.window';

/**
 * Registered by Posit Assistant (cross-repo contract): moves the active Assistant chat tab's
 * conversation into a window panel in the dedicated Assistant window, and closes the tab. Resolves
 * `false` when it did nothing.
 */
const ASSISTANT_MOVE_TO_WINDOW_COMMAND_ID = 'posit-assistant.moveToWindow';

/**
 * "Move (or Copy) Editor into New Window" for a single Posit Assistant chat tab: has Posit
 * Assistant move it into the dedicated Assistant window, where its conversation shows Assistant's
 * own tabs. Resolves `true` when Assistant handled it; `false` (an older Assistant, or anything
 * but a single chat tab) means the caller moves the editors itself.
 */
export async function moveAssistantTabToWindow(commandService: ICommandService, group: IEditorGroup, editors: readonly EditorInput[]): Promise<boolean> {
	if (editors.length !== 1 || editors[0].editorId !== `mainThreadWebview-${ASSISTANT_WEBVIEW_VIEW_TYPE}` || !CommandsRegistry.getCommand(ASSISTANT_MOVE_TO_WINDOW_COMMAND_ID)) {
		return false;
	}
	// Assistant moves the active tab, the same contract as `positron.assistantWindow.enter`.
	await group.openEditor(editors[0]);
	group.focus();
	return await commandService.executeCommand<boolean>(ASSISTANT_MOVE_TO_WINDOW_COMMAND_ID) === true;
}

/**
 * Whether an editor is a Posit Assistant window panel.
 */
export function isAssistantWindowEditor(editor: EditorInput): boolean {
	return editor.editorId === `mainThreadWebview-${ASSISTANT_WINDOW_VIEW_TYPE}`;
}

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
 * Determines auxiliary window options for editors being moved to a new window.
 * Plot editors get a small compact window; Posit Assistant chat tabs get the dedicated window.
 */
export function getAuxiliaryWindowOptionsForEditors(editors: readonly EditorInput[], sourceWindow: Window): IAuxiliaryWindowOpenOptions | undefined {
	if (editors.some(editor => editor.typeId === 'workbench.input.positronPlots')) {
		return {
			compact: true,
			bounds: { width: 900, height: 700 }
		};
	}
	// Webview tabs report `mainThreadWebview-<view type>` as their editor id. Only when every
	// moved editor is an Assistant tab: the compact window has no tabs to reach any others.
	if (editors.length > 0 && editors.every(editor => editor.editorId === `mainThreadWebview-${ASSISTANT_WEBVIEW_VIEW_TYPE}`)) {
		return dedicatedWindowOptions(sourceWindow);
	}
	return undefined;
}

/**
 * The dedicated Assistant window: the dedicated look, with compact mode locked on so a stray
 * editor or menu action can't bring Positron's chrome back, as Canvas does.
 */
export function assistantWindowOptions(sourceWindow: Window): IAuxiliaryWindowOpenOptions {
	return dedicatedWindowOptions(sourceWindow, { lockCompact: true });
}
