/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IOverlayWebview, } from 'vs/workbench/contrib/webview/browser/webview';

// Message sent by the webview when the widget has finished rendering; used to
// coordinate thumbnail generation.
export const RENDER_COMPLETE = 'render_complete';

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
	 * @param runtimeId The ID of the runtime that owns this webview.
	 * @param webview The underlying webview.
	 */
	constructor(
		readonly id: string,
		readonly sessionId: string,
		readonly webview: IOverlayWebview) {
		super();

		this.onDidRender = this._onDidRender.event;
		this._register(this._onDidRender);

		this._register(webview.onMessage(e => {
			if (e.message === RENDER_COMPLETE) {
				this._onDidRender.fire();
			}
		}));
	}

	onDidRender: Event<void>;

	public override dispose(): void {
		this.webview.dispose();
		super.dispose();
	}
}
