/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../common/editor/editorInput.js';
import { ASSISTANT_WEBVIEW_VIEW_TYPE } from '../../../common/positronAssistantIdentity.js';
import { IAuxiliaryWindowOpenOptions } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';

/**
 * The single definition of the "dedicated window" look: native OS title bar,
 * compact chrome, sized to (and opening over) the window the editor leaves.
 * `extraTraits` may add traits but never replace the shape -- the dedicated
 * look wins.
 */
export function dedicatedWindowOptions(sourceWindow: Window, extraTraits?: IAuxiliaryWindowOpenOptions): IAuxiliaryWindowOpenOptions {
	return {
		...extraTraits,
		compact: true,
		nativeTitlebar: true,
		bounds: { width: sourceWindow.outerWidth, height: sourceWindow.outerHeight }
	};
}

/**
 * Determines auxiliary window options for editors being moved to a new window.
 * Plot editors get a small compact window; Posit Assistant chat tabs get the dedicated window.
 */
export function getAuxiliaryWindowOptionsForEditors(editors: readonly EditorInput[], sourceWindow: Window): IAuxiliaryWindowOpenOptions | undefined {
	if (editors.some(editor => editor.typeId === 'workbench.input.positronPlots')) {
		return {
			compact: true,
			bounds: { width: 900, height: 700 }
		};
	}
	// Webview tabs report `mainThreadWebview-<view type>` as their editor id. Only when every
	// moved editor is an Assistant tab: the compact window has no tabs to reach any others.
	if (editors.length > 0 && editors.every(editor => editor.editorId === `mainThreadWebview-${ASSISTANT_WEBVIEW_VIEW_TYPE}`)) {
		return dedicatedWindowOptions(sourceWindow);
	}
	return undefined;
}
