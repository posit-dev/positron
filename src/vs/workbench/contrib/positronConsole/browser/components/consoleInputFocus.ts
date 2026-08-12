/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { FocusedViewContext } from '../../../../common/contextkeys.js';
import { IWebviewService } from '../../../webview/browser/webview.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { POSITRON_CONSOLE_VIEW_ID } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

/**
 * Determines whether the console input may take keyboard focus.
 *
 * The console input takes focus when it becomes the active console instance and when it mounts.
 * Both happen during startup, when a runtime auto-starts from an affiliation or a restored
 * session, so the console must not take focus out from under a user who is working somewhere
 * else. See https://github.com/posit-dev/positron/issues/2802 and
 * https://github.com/posit-dev/positron/issues/13155.
 *
 * Focus is refused whenever the user is somewhere intentional. When nothing meaningful holds
 * focus, which is the case on an idle launch, the console does take focus, because console-first
 * users expect to launch Positron and start typing.
 *
 * @param contextKeyService The context key service.
 * @param layoutService The workbench layout service.
 * @param webviewService The webview service.
 * @param activeElement The active element, used to resolve scoped context keys.
 * @returns true if it is OK to take focus; otherwise, false.
 */
export function okToTakeFocus(
	contextKeyService: IContextKeyService,
	layoutService: IWorkbenchLayoutService,
	webviewService: IWebviewService,
	activeElement: Element | null
): boolean {
	// Get the context key service context at the active element so that scoped keys resolve from
	// the focused widget.
	const context = contextKeyService.getContext(activeElement);

	// Sensitive to all editor contexts, simple (e.g. git commit textbox) or not (e.g. code
	// editor).
	if (context.getValue(EditorContextKeys.textInputFocus.key)) {
		return false;
	}

	// Sensitive to all quick pick contexts, e.g. the command palette or the file picker.
	if (context.getValue(InQuickPickContextKey.key)) {
		return false;
	}

	// Sensitive to terminal focus.
	if (context.getValue(TerminalContextKeys.focus.key)) {
		return false;
	}

	// Sensitive to focus in any other view. Every view pane sets this key, so one check covers
	// Search, Variables, Help, Plots, the Explorer, and any view added later. Focus inside the
	// console view itself is fine; that is where the console input lives.
	const focusedView = context.getValue<string>(FocusedViewContext.key);
	if (focusedView && focusedView !== POSITRON_CONSOLE_VIEW_ID) {
		return false;
	}

	// Sensitive to focus anywhere in the editor part. This covers editors that hold focus without
	// a text input, e.g. the Settings editor, the Data Explorer, and the welcome page.
	if (layoutService.hasFocus(Parts.EDITOR_PART)) {
		return false;
	}

	// Sensitive to focus inside a webview, e.g. a chat view contributed by an extension or the
	// Help pane. A webview mounts its iframe in an overlay at the workbench root rather than
	// inside its view pane, so focus in the iframe never reaches the view pane's focus tracker:
	// `focusedView` is reset to empty and the checks above all miss it.
	if (webviewService.activeWebview) {
		return false;
	}

	// It's OK to take focus.
	return true;
}
