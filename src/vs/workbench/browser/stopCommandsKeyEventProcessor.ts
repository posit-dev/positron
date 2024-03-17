/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { EventHelper } from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ResultKind } from 'vs/platform/keybinding/common/keybindingResolver';
import { IKeyEventProcessor } from 'vs/base/browser/ui/positronModalReactRenderer/keyEventProcessor';

/**
 * Commands that are allowed.
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
 * KeyEventProcessor class.
 */
export class StopCommandsKeyEventProcessor implements IKeyEventProcessor {
	/**
	 * Constructor.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 */
	constructor(
		private readonly _keybindingService: IKeybindingService,
		private readonly _layoutService: ILayoutService,
	) { }

	/**
	 * Processes a StandardKeyboardEvent.
	 * @param event The StandardKeyboardEvent.
	 */
	processKeyEvent(event: StandardKeyboardEvent): void {
		// Soft dispatch the keyboard event.
		const resolutionResult = this._keybindingService.softDispatch(
			event,
			this._layoutService.activeContainer
		);

		// If the keyboard event was found and resolves to a comment ID, stop it from being
		// processed.
		if (resolutionResult.kind === ResultKind.KbFound && resolutionResult.commandId) {
			if (ALLOWABLE_COMMANDS.indexOf(resolutionResult.commandId) === -1) {
				EventHelper.stop(event, true);
			}
		}
	}
}
