/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';

export class PreviewOverlayWebview extends Disposable {

	public onDidNavigate = this.webview.onDidNavigate;
	public onDidDispose = this.webview.onDidDispose;

	constructor(public readonly webview: IOverlayWebview) {
		super();
		this._register(webview);
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
				<script>
					// Get a reference to the VS Code API
					const vscode = acquireVsCodeApi();
					// Listen for messages from the parent window
					window.addEventListener('message', e => {
						// Ignore non-command messages
						if (!e.data.channel === 'execCommand') {
							return;
						}

						// Get the IFrame element hosting the preview URL
						const iframe = document.querySelector('iframe');

						// Dispatch the command
						switch (e.data.data) {
							case 'reload-window': {
								iframe.src = iframe.src;
								break;
							}
							case 'navigate-back': {
								history.back();
								break;
							}
							case 'navigate-forward': {
								history.forward();
								break;
							}
						}
					});
				</script>
			</head>
			<body>
				<iframe src="${uri.toString()}"></iframe>
			</body>
		</html>`);
	}
}
