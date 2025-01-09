/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { WebviewPlotClient } from './webviewPlotClient.js';
import { ILanguageRuntimeMessageWebOutput } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';

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

	protected override async createWebview() {
		if (this._output.value) {
			throw new Error('Webview already created. Dispose the existing webview first.');
		}
		const output = await this._notebookOutputWebviewService.createMultiMessageWebview({
			runtimeId: this._session.sessionId,
			preReqMessages: this._preReqMessages,
			displayMessage: this._displayMessage,
			viewType: 'jupyter-notebook'
		});
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
