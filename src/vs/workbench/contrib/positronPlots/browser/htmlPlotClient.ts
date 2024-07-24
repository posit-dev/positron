/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { PreviewHtml } from 'vs/workbench/contrib/positronPreview/browser/previewHtml';

/**
 * A Positron plot instance that is backed by a webview.
 */
export class HtmlPlotClient extends WebviewPlotClient {

	private static _nextId = 0;

	/**
	 * Creates a new HtmlPlotClient, which wraps an HTML preview webview in an
	 * object that can be displayed in the Plots pane.
	 *
	 * @param html The webview to wrap.
	 * @param message The output message from which the webview was created.
	 * @param code The code that generated the webview (if known)
	 */
	constructor(public readonly html: PreviewHtml) {
		// Create the metadata for the plot.
		super({
			id: `plot-${HtmlPlotClient._nextId++}`,
			parent_id: '',
			created: Date.now(),
			session_id: html.sessionId,
			code: '',
		}, html.webview.webview);

		this._register(this.html.webview.onDidLoad(e => {
			this.nudgeRenderThumbnail();
		}));
	}
}
