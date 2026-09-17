/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../base/common/lifecycle.js';

/**
 * Holders asking the editor parts to leave the live layout alone while the
 * stored editor layout changes underneath them.
 *
 * A Canvas folder switch swaps the workspace storage under a live window.
 * Both editor-part memento listeners treat an external change to their
 * workspace-scoped layout as "adopt the stored layout": `EditorParts` closes
 * every auxiliary window and recreates the stored ones, and the main
 * `EditorPart` rebuilds its groups from the stored grid. Under a switch that
 * would close the Canvas window and race the switch's own cleanup of the
 * source folder's editors. The switch holds this while `storageService.switch`
 * runs and then applies the destination's main layout itself through
 * `EditorPart.applyStoredState()`.
 */
let holders = 0;

/** Hold the live editor layout through stored-layout changes until disposed. Nests. */
export function holdStoredEditorLayout(): IDisposable {
	holders++;
	return toDisposable(() => {
		holders--;
	});
}

/** Whether an externally changed stored editor layout must not be applied right now. */
export function isStoredEditorLayoutHeld(): boolean {
	return holders > 0;
}
