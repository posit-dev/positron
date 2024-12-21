/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';

export class PreviewOverlayWebview extends Disposable {

	public onDidNavigate = this.webview.onDidNavigate;
	public onDidDispose = this.webview.onDidDispose;
	public onDidLoad = this.webview.onDidLoad;

	constructor(public readonly webview: IOverlayWebview) {
		super();
		this._register(webview);
	}

	public setTitle(value: string): void {
		this.webview.setTitle(value);
	}

	public postMessage(message: any, transfer?: readonly ArrayBuffer[]): Promise<boolean> {
		return this.webview.postMessage(message, transfer);
	}

	/**
	 * Loads a URI in the internal webview.
	 *
	 * This is overridden in the Electron implementation to use the webview's
	 * `loadUri` method, which has native support for loading URIs.
	 *
	 * @param uri The URI to load
	 */
	public loadUri(uri: URI): void {
		// This Preview pane HTML is roughly equivalent to src/vs/workbench/contrib/positronHelp/browser/resources/help.html
		// for the Help pane.
		this.webview.setHtml(`
		<html>
			<head>
				<style>
					html, body {
						padding: 0;
						margin: 0;
						height: 100%;
						min-height: 100%;
					}
					iframe {
						width: 100%;
						height: 100%;
						border: none;
						display: block;
					}
				</style>
			</head>
			<body>
				<iframe id="preview-iframe" title="Preview Content" src="${uri.toString()}"></iframe>
				<script async type="module">
					// Get a reference to the VS Code API
					const vscode = acquireVsCodeApi();

					// Get the preview iframe content window
					const previewContentWindow = document.getElementById("preview-iframe").contentWindow;

					// Listen for messages
					window.addEventListener('message', message => {
						if (message.source === previewContentWindow && message.data.channel !== 'execCommand') {
							// If a message is coming from the preview content window, forward it to the
							// preview overlay webview.
							vscode.postMessage({
								__positron_preview_message: true,
								...message.data
							});
						} else {
							// Forward messages from the preview overlay webview to the preview content window.
							// Messages may include commands to navigate back, forward, reload, etc.,
							// via the 'execCommand' channel.
							previewContentWindow.postMessage(message.data, '*');
						}
					});
				</script>
			</body>
		</html>`);
	}
}
