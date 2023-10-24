/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IOverlayWebview, } from 'vs/workbench/contrib/webview/browser/webview';

export class NotebookOutputWebview extends Disposable implements INotebookOutputWebview {

	constructor(
		readonly id: string,
		readonly webview: IOverlayWebview) {
		super();
	}

	public override dispose(): void {
		this.webview.dispose();
		super.dispose();
	}
}
