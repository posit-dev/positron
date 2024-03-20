/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EventHelper } from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ResultKind } from 'vs/platform/keybinding/common/keybindingResolver';
import { IKeyEventProcessor } from 'vs/base/browser/ui/positronModalReactRenderer/keyEventProcessor';

/**
 * Commands that are allowed through.
 */
const ALLOWABLE_COMMANDS = [
	'copy',
	'cut',
	'undo',
	'redo',
	'editor.action.selectAll',
	'editor.action.clipboardCopyAction',
	'editor.action.clipboardCutAction',
	'editor.action.clipboardPasteAction',
	'workbench.action.quit',
	'workbench.action.reloadWindow'
];

/**
 * StopCommandsKeyEventProcessor class.
 */
export class StopCommandsKeyEventProcessor implements IKeyEventProcessor {
	/**
	 * Constructor.
	 * @param keybindingService The keybinding service.
	 * @param layoutService The layout service.
	 */
	constructor(private readonly _options: {
		readonly keybindingService: IKeybindingService;
		readonly layoutService: ILayoutService;
	}) { }

	/**
	 * Processes a key event.
	 * @param event The key event to process.
	 */
	processKeyEvent(event: StandardKeyboardEvent): void {
		// Soft dispatch the key event so we can determine whether it is bound to a command.
		const resolutionResult = this._options.keybindingService.softDispatch(
			event,
			this._options.layoutService.activeContainer
		);

		// If a keybinding to a command was found, stop it from being processed if it is not one of
		// the allowable commands.
		if (resolutionResult.kind === ResultKind.KbFound && resolutionResult.commandId) {
			if (ALLOWABLE_COMMANDS.indexOf(resolutionResult.commandId) === -1) {
				EventHelper.stop(event, true);
			}
		}
	}
}
