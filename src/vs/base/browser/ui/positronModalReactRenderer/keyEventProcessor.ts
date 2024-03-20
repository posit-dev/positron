/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';

/**
 * IKeyEventProcessor interface.
 */
export interface IKeyEventProcessor {
	/**
	 * Processes a key event.
	 * @param event The key event to process.
	 */
	processKeyEvent(event: StandardKeyboardEvent): void;
}
