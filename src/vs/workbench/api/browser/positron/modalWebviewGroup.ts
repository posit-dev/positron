/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MODAL_GROUP, UseModalEditorMode } from '../../../services/editor/common/editorService.js';

export interface ModalWebviewGroupOptions {
	/** Whether the panel asked to be shown modal. */
	readonly modal: boolean;
	/** Current value of `workbench.editor.useModal`. */
	readonly useModalSetting: UseModalEditorMode | undefined;
}

/**
 * The group a modal-capable webview panel should open in.
 *
 * Returns `MODAL_GROUP` when the panel should be presented as a centered modal,
 * or `undefined` to mean "fall through to normal group resolution", which opens
 * the panel as an ordinary editor tab.
 *
 * Deliberately does not consider whether a modal editor part already exists.
 * `editorGroupFinder.doFindGroup` creates one on demand when it sees
 * `MODAL_GROUP`, and `IEditorGroupsService.activeModalEditorPart` is `undefined`
 * until something has opened a modal in this window -- gating on it would make
 * the first modal panel of a session silently open as a tab.
 *
 * The `'off'` check duplicates one `editorGroupFinder` already performs. It is
 * kept because `positron.window.createModalWebviewPanel` documents that the
 * user's opt-out wins, and this is the boundary where that promise is made, so
 * it is worth asserting here rather than inheriting it from a downstream detail.
 */
export function resolveModalWebviewGroup(options: ModalWebviewGroupOptions): number | undefined {
	if (!options.modal) {
		return undefined;
	}
	if (options.useModalSetting === 'off') {
		return undefined;
	}
	return MODAL_GROUP;
}
