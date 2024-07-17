/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { FromWebviewMessage } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewMessages';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IOverlayWebview, } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * A notebook output webview wraps a webview that contains rendered HTML content
 * from notebooks (including raw HTML or the Notebook Renderer API).
 */
export class NotebookOutputWebview extends Disposable implements INotebookOutputWebview {

	private readonly _onDidRender = new Emitter<void>;

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
		readonly webview: IOverlayWebview,
		readonly render?: () => void,
	) {
		super();

		this.onDidRender = this._onDidRender.event;
		this._register(this._onDidRender);

		this._register(webview.onMessage(e => {
			const data: FromWebviewMessage | { readonly __vscode_notebook_message: undefined } = e.message;

			if (!data.__vscode_notebook_message) {
				return;
			}

			switch (data.type) {
				case 'positronRenderComplete':
					this._onDidRender.fire();
					break;
			}

		}));
	}

	onDidRender: Event<void>;

	public override dispose(): void {
		this.webview.dispose();
		super.dispose();
	}
}
