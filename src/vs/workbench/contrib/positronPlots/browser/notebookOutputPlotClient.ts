/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * A Positron plot instance created from notebook output rendered into a
 * webview.
 */
export class NotebookOutputPlotClient extends WebviewPlotClient {

	/**
	 * Creates a new NotebookOutputPlotClient, which wraps a notebook output
	 * webview in an object that can be displayed in the Plots pane.
	 *
	 * @param output The notebook output webview to wrap.
	 * @param message The output message from which the webview was created.
	 * @param code The code that generated the webview (if known)
	 */
	constructor(public readonly output: INotebookOutputWebview,
		message: ILanguageRuntimeMessageOutput,
		code?: string) {

		// Create the metadata for the plot.
		super({
			id: message.id,
			parent_id: message.parent_id,
			created: Date.parse(message.when),
			session_id: output.sessionId,
			code: code ? code : '',
		}, output.webview);

		// Ensure that the output is disposed when the plot client is disposed.
		this._register(output);

		// Wait for the webview to finish rendering. When it does, nudge the
		// timer that renders the thumbnail.
		this._register(this.output.onDidRender(e => {
			this.nudgeRenderThumbnail();
		}));
	}

	/**
	 * Claims the underlying webview.
	 *
	 * @param claimant The object taking ownership.
	 */
	public override claim(claimant: any) {
		super.claim(claimant);
		this.output.render?.();
	}
}
