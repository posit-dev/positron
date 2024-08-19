/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * A Positron plot instance created from notebook output rendered into a
 * webview.
 */
export class NotebookOutputPlotClient extends WebviewPlotClient {

	private readonly _output = this._register(new MutableDisposable<INotebookOutputWebview>());

	private readonly _outputEvents = this._register(new DisposableStore());

	/**
	 * Creates a new NotebookOutputPlotClient, which manages the lifecycle of a notebook output
	 * webview, wrapped in an object that can be displayed in the Plots pane.
	 *
	 * @param _notebookOutputWebviewService The notebook output webview service.
	 * @param _session The runtime session that emitted the output.
	 * @param _message The message containing the contents to be rendered in the webview.
	 * @param code The code that generated the webview (if known)
	 */
	constructor(
		private readonly _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		private readonly _session: ILanguageRuntimeSession,
		private readonly _message: ILanguageRuntimeMessageOutput,
		code?: string) {

		// Create the metadata for the plot.
		super({
			id: _message.id,
			parent_id: _message.parent_id,
			created: Date.parse(_message.when),
			session_id: _session.sessionId,
			code: code ? code : '',
		});
	}

	protected override async createWebview() {
		if (this._output.value) {
			throw new Error('Webview already created. Dispose the existing webview first.');
		}
		const output = await this._notebookOutputWebviewService.createNotebookOutputWebview(
			this.id,
			this._session,
			this._message,
			'jupyter-notebook'
		);
		if (!output) {
			throw new Error('Failed to create notebook output webview');
		}
		this._output.value = output;
		// Wait for the webview to finish rendering. When it does, nudge the
		// timer that renders the thumbnail.
		this._outputEvents.add(output.onDidRender(e => {
			this.nudgeRenderThumbnail();
		}));

		return output.webview;
	}

	protected override disposeWebview() {
		this._output.clear();
		this._outputEvents.clear();
	}
}
