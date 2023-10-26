/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IOverlayWebview, } from 'vs/workbench/contrib/webview/browser/webview';

export const RENDER_COMPLETE = 'render_complete';

export class NotebookOutputWebview extends Disposable implements INotebookOutputWebview {

	private readonly _onDidRender = new Emitter<void>;

	constructor(
		readonly id: string,
		readonly runtimeId: string,
		readonly webview: IOverlayWebview) {
		super();

		this.onDidRender = this._onDidRender.event;

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
