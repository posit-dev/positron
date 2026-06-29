/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICachedNotebookRender } from './notebookRenderCache.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';

/**
 * Dispose a NotebookRenderCache entry. The conditional detach guards against
 * cross-group moves: the workbench opens an editor in the target pane before
 * closing it in the source, so by eviction time the shared instance may have
 * already been re-attached elsewhere -- detaching unconditionally would tear
 * down that destination view.
 */
export function disposeNotebookRenderCacheEntry(
	entry: ICachedNotebookRender,
	instance: PositronNotebookInstance | undefined,
): void {
	entry.renderer.dispose();
	entry.container.remove();
	if (instance && instance.isAttachedTo(entry.container)) {
		instance.detachView();
	}
}
