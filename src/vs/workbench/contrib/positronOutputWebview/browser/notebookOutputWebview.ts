/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookWebviewMessage } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { FromWebviewMessage } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewMessages';
import { IScopedRendererMessaging } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IOverlayWebview, IWebviewElement } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * A notebook output webview wraps a webview that contains rendered HTML content
 * from notebooks (including raw HTML or the Notebook Renderer API).
 */
export class NotebookOutputWebview<WType extends IOverlayWebview | IWebviewElement = IOverlayWebview> extends Disposable implements INotebookOutputWebview<WType> {

	private readonly _onDidRender = new Emitter<void>;
	private readonly _onDidReceiveMessage = new Emitter<INotebookWebviewMessage>();

	/**
	 * Create a new notebook output webview.
	 *
	 * @param id A unique ID for this webview; typically the ID of the message
	 *   that created it.
	 * @param sessionId The ID of the runtime that owns this webview.
	 * @param webview The underlying webview.
	 */
	constructor(
		readonly id: string,
		readonly sessionId: string,
		readonly webview: WType,
		readonly render?: () => void,
		readonly rendererMessaging?: IScopedRendererMessaging,
	) {
		super();

		this.onDidRender = this._onDidRender.event;
		this.onDidReceiveMessage = this._onDidReceiveMessage.event;
		this._register(this._onDidRender);
		this._register(this._onDidReceiveMessage);

		if (rendererMessaging) {
			this._register(rendererMessaging);
			rendererMessaging.receiveMessageHandler = async (rendererId, message) => {
				this.webview.postMessage({
					__vscode_notebook_message: true,
					type: 'customRendererMessage',
					rendererId,
					message,
				});

				return true;
			};
		}

		this._register(webview.onMessage(e => {
			const data: FromWebviewMessage | { readonly __vscode_notebook_message: undefined } = e.message;

			if (!data.__vscode_notebook_message) {
				return;
			}

			switch (data.type) {
				case 'customKernelMessage':
					this._onDidReceiveMessage.fire({ message: data.message });
					break;
				case 'customRendererMessage':
					this.rendererMessaging?.postMessage(data.rendererId, data.message);
				case 'positronRenderComplete':
					this._onDidRender.fire();
					break;
			}

		}));
	}

	onDidRender: Event<void>;
	onDidReceiveMessage: Event<INotebookWebviewMessage>;

	postMessage(message: unknown): void {
		this.webview.postMessage({
			__vscode_notebook_message: true,
			type: 'customKernelMessage',
			message
		});
	}

	public override dispose(): void {
		this.webview.dispose();
		super.dispose();
	}
}
