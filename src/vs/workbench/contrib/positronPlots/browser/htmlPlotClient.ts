/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PreviewHtml } from 'vs/workbench/contrib/positronPreview/browser/previewHtml';
import { WebviewExtensionDescription } from 'vs/workbench/contrib/webview/browser/webview';
import { IShowHtmlUriEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * A Positron plot instance that contains content from an HTML file.
 */
export class HtmlPlotClient extends WebviewPlotClient {

	private readonly _html = this._register(new MutableDisposable<PreviewHtml>());

	private readonly _htmlEvents = this._register(new DisposableStore());

	private static _nextId = 0;

	/**
	 * Creates a new HtmlPlotClient, which manages the lifecycle of an HTML preview webview,
	 * wrapped in an object that can be displayed in the Plots pane.
	 *
	 * @param _positronPreviewService The preview service.
	 * @param _session The runtime session that emitted the output.
	 * @param _event The event that triggered the preview.
	 */
	constructor(
		private readonly _positronPreviewService: IPositronPreviewService,
		private readonly _session: ILanguageRuntimeSession,
		private readonly _event: IShowHtmlUriEvent) {
		// Create the metadata for the plot.
		super({
			id: `plot-${HtmlPlotClient._nextId++}`,
			parent_id: '',
			created: Date.now(),
			session_id: _session.sessionId,
			code: '',
		});
	}

	get uri(): URI {
		return this._event.uri;
	}

	async createWebview() {
		if (this._html.value) {
			// Already awake, do nothing.
			return;
		}
		// Create the webview.
		const extension = this._session.runtimeMetadata.extensionId;
		const webviewExtension: WebviewExtensionDescription = {
			id: extension
		};
		const html = this._positronPreviewService.createHtmlWebview(this._session.sessionId,
			webviewExtension, this._event);
		this._html.value = html;
		this._webview.value = html.webview.webview;

		// Render the thumbnail when the webview loads.
		this._htmlEvents.add(html.webview.onDidLoad(e => {
			this.nudgeRenderThumbnail();
		}));
	}
}
