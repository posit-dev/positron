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
	'editor.action.selectAll',
	'editor.action.clipboardCopyAction',
	'editor.action.clipboardCutAction',
	'editor.action.clipboardPasteAction'
];

/**
 * StopCommandsKeyEventProcessor class.
 */
export class StopCommandsKeyEventProcessor implements IKeyEventProcessor {
	/**
	 * Constructor.
	 */
	constructor(private readonly _options: {
		readonly keybindingService: IKeybindingService;
		readonly layoutService: ILayoutService;
	}) { }

	/**
	 * Processes a StandardKeyboardEvent.
	 * @param event The StandardKeyboardEvent.
	 */
	processKeyEvent(event: StandardKeyboardEvent): void {
		// Soft dispatch the keyboard event so we can determine whether we need to stop it from
		// being processed.
		const resolutionResult = this._options.keybindingService.softDispatch(
			event,
			this._options.layoutService.activeContainer
		);

		// If the keyboard event was found and it resolved to a command, we must stop it from being
		// processed.
		if (resolutionResult.kind === ResultKind.KbFound && resolutionResult.commandId) {
			if (ALLOWABLE_COMMANDS.indexOf(resolutionResult.commandId) === -1) {
				EventHelper.stop(event, true);
			}
		}
	}
}
