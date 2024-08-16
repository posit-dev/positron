/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { ILanguageRuntimeMessageWebOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * A Positron plot instance created from multiple notebook output messages rendered into a
 * webview.
 */
export class NotebookMultiMessagePlotClient extends WebviewPlotClient {

	private readonly _output = this._register(new MutableDisposable<INotebookOutputWebview>());

	private readonly _outputEvents = this._register(new DisposableStore());

	/**
	 * Creates a new NotebookMultiMessagePlotClient, which manages the lifecycle of a notebook output
	 * webview, wrapped in an object that can be displayed in the Plots pane.
	 *
	 * @param _notebookOutputWebviewService The notebook output webview service.
	 * @param _session The runtime session that emitted the output.
	 * @param _preReqMessages The messages linked to the final display output message that load the
	 * required dependencies.
	 * @param _displayMessage The message containing the contents to be rendered in the webview.
	 * @param code The code that generated the webview (if known)
	 */
	constructor(
		private readonly _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		private readonly _session: ILanguageRuntimeSession,
		private readonly _preReqMessages: ILanguageRuntimeMessageWebOutput[],
		private readonly _displayMessage: ILanguageRuntimeMessageWebOutput,
		code?: string) {

		// Create the metadata for the plot.
		super({
			id: _displayMessage.id,
			parent_id: _displayMessage.parent_id,
			created: Date.parse(_displayMessage.when),
			session_id: _session.sessionId,
			code: code ? code : '',
		});
	}

	async createWebview() {
		if (this._output.value) {
			throw new Error('Webview already created');
		}
		const output = await this._notebookOutputWebviewService.createMultiMessageWebview({
			runtime: this._session,
			preReqMessages: this._preReqMessages,
			displayMessage: this._displayMessage,
			viewType: 'jupyter-notebook'
		});
		if (!output) {
			throw new Error('Failed to create notebook output webview');
		}
		this._output.value = output;
		this._webview.value = output.webview;

		// Wait for the webview to finish rendering. When it does, nudge the
		// timer that renders the thumbnail.
		this._outputEvents.add(output.onDidRender(e => {
			this.nudgeRenderThumbnail();
		}));
	}
}

