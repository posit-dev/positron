/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuxiliaryWindowOpenOptions } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';

/**
 * Whether layout restore recreates a saved auxiliary editor window. Not a
 * Canvas window (the `lockCompact` trait, which only Canvas mode sets): the
 * native window would be on screen, blank, before Canvas startup could hide
 * it, and Canvas mode creates its own window when it enters. Its Canvas panel
 * goes with it; Posit Assistant reopens the last conversation in a fresh one.
 */
export function shouldRestoreAuxiliaryEditorPart(state: IAuxiliaryWindowOpenOptions): boolean {
	return state.lockCompact !== true;
}
