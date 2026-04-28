/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICachedNotebookRender } from './notebookRenderCache.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';

/**
 * Dispose policy for a NotebookRenderCache entry: dispose the renderer, remove
 * the container from the DOM, and detach the shared notebook instance only if
 * its container observable still points at this entry's container.
 *
 * The conditional detach guards against cross-group moves: when a tab moves
 * between editor groups, the workbench opens the editor in the target pane
 * before closing it in the source pane. By the time the source pane's cache
 * eviction runs, the shared instance may already have been re-attached to the
 * target pane's container -- detaching unconditionally would tear down the
 * destination view.
 */
export function disposeNotebookRenderCacheEntry(entry: ICachedNotebookRender): void {
	entry.renderer.dispose();
	entry.container.remove();
	const instance = PositronNotebookInstance._instanceMap.get(entry.uri);
	if (instance && instance.isAttachedTo(entry.container)) {
		instance.detachView();
	}
}
