/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { WebviewPlotClient } from './webviewPlotClient.js';
import { IPositronPreviewService } from '../../positronPreview/browser/positronPreviewSevice.js';
import { PreviewHtml } from '../../positronPreview/browser/previewHtml.js';
import { WebviewExtensionDescription } from '../../webview/browser/webview.js';
import { IShowHtmlUriEvent } from '../../../services/languageRuntime/common/languageRuntimeUiClient.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';

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
		private readonly _openerService: IOpenerService,
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

	protected override async createWebview() {
		if (this._html.value) {
			throw new Error('Webview already created. Dispose the existing webview first.');
		}
		// Create the webview.
		const extension = this._session.runtimeMetadata.extensionId;
		const webviewExtension: WebviewExtensionDescription = {
			id: extension
		};
		const html = this._positronPreviewService.createHtmlWebview(this._session.sessionId,
			webviewExtension, this._event);
		this._html.value = html;

		// Render the thumbnail when the webview loads.
		this._htmlEvents.add(html.webview.onDidLoad(e => {
			this.nudgeRenderThumbnail();
		}));

		// Handle link clicks from the webview
		this._register(html.webview.webview.onDidClickLink((link) => {
			this._openerService.open(link, {
				fromUserGesture: true
			});
		}));
		return html.webview.webview;
	}

	protected override disposeWebview() {
		this._html.clear();
		this._htmlEvents.clear();
	}
}
