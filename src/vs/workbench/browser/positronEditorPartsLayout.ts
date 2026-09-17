/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../base/common/lifecycle.js';

/**
 * Holders asking the editor parts to keep their auxiliary windows when the
 * stored editor layout changes underneath them.
 *
 * `EditorParts` treats an external change to its workspace-scoped layout as
 * "adopt this layout": it closes every auxiliary window and recreates the
 * stored ones. That is right for a window entering a workspace from nothing,
 * and wrong for Canvas mode, whose whole surface is an auxiliary window: a
 * Canvas folder switch swaps the workspace storage while that window must
 * stay up. The main editor part still adopts the folder's own layout.
 */
let holders = 0;

/** Keep auxiliary editor windows through stored-layout changes until disposed. Nests. */
export function keepAuxiliaryEditorParts(): IDisposable {
	holders++;
	return toDisposable(() => {
		holders--;
	});
}

/** Whether an externally changed editor layout must leave the auxiliary windows alone. */
export function shouldKeepAuxiliaryEditorParts(): boolean {
	return holders > 0;
}
