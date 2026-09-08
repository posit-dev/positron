/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export namespace window {
		/**
		 * Create and show a new webview panel, optionally in the modal editor overlay
		 * that Settings, Extensions and MCP servers are presented in.
		 *
		 * @param viewType Identifies the type of the webview panel.
		 * @param title Title of the panel.
		 * @param showOptions Where the webview panel should be shown.
		 * @param options Settings for the new panel.
		 *
		 * @returns New webview panel.
		 */
		export function createWebviewPanel(viewType: string, title: string, showOptions: {
			/**
			 * The view column in which the {@link WebviewPanel} should be shown.
			 * Ignored when `modal` is `true`.
			 */
			readonly viewColumn?: ViewColumn;
			/**
			 * An optional flag that when `true` will stop the panel from taking focus.
			 */
			readonly preserveFocus?: boolean;
			/**
			 * Show the panel in a centered modal overlay on top of the workbench.
			 *
			 * The panel is disposed when the modal is dismissed, in the same way it is
			 * disposed when its editor tab is closed. Any state that must survive
			 * dismissal has to be persisted by the extension.
			 *
			 * Ignored when the user has set `workbench.editor.useModal` to `off`.
			 */
			readonly modal?: boolean;
		}, options?: WebviewPanelOptions & WebviewOptions): WebviewPanel;
	}
}
