/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';

/**
 * IKeyEventProcessor.
 */
export interface IKeyEventProcessor {
	processKeyEvent(event: StandardKeyboardEvent): void;
}
