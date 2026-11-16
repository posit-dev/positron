/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { WebviewPlotClient } from './webviewPlotClient.js';
import { ILanguageRuntimeMessageOutput } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * Matches Vega and Vega-Lite MIME types, such as `application/vnd.vegalite.v5+json`.
 */
const VegaMimeTypeRegex = /^application\/vnd\.(?<library>vega|vegalite)\.v(?<version>\d+)\+json$/;

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
			execution_id: _message.parent_id,
			created: Date.parse(_message.when),
			session_id: _session.sessionId,
			code: code ? code : '',
			output_id: _message.output_id,
		});
	}

	/**
	 * Creates a copy of this plot client. The copy renders the same output in
	 * its own webview, so it can be shown in an editor.
	 */
	copy(): NotebookOutputPlotClient {
		return new NotebookOutputPlotClient(this._notebookOutputWebviewService, this._session, this._message, this.metadata.code);
	}

	/**
	 * Whether the output is a Vega or Vega-Lite plot, which can be rendered as
	 * a standalone HTML document.
	 */
	get hasStandaloneHtml(): boolean {
		return Object.keys(this._message.data).some(mimeType => VegaMimeTypeRegex.test(mimeType));
	}

	/**
	 * Gets a standalone HTML document that renders this plot in a web browser,
	 * or `undefined` if the output is not a Vega or Vega-Lite plot. The document
	 * loads Vega from a CDN.
	 */
	get standaloneHtml(): string | undefined {
		for (const [mimeType, spec] of Object.entries(this._message.data)) {
			const groups = VegaMimeTypeRegex.exec(mimeType)?.groups;
			if (!groups) {
				continue;
			}
			const majorVersion = Number(groups.version);

			// Vega-Lite 6 requires Vega 6; earlier Vega-Lite versions use Vega 5.
			const vegaVersion = groups.library === 'vega' ? majorVersion : Math.max(5, Math.min(majorVersion, 6));
			const vegaEmbedVersion = vegaVersion >= 6 ? 7 : 6;
			const vegaLiteScript = groups.library === 'vegalite'
				? `<script src="https://cdn.jsdelivr.net/npm/vega-lite@${majorVersion}"></script>`
				: '';

			// Escape '<' so the spec cannot close the script tag.
			const specJson = JSON.stringify(spec).replace(/</g, '\\u003c');
			return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/vega@${vegaVersion}"></script>
${vegaLiteScript}
<script src="https://cdn.jsdelivr.net/npm/vega-embed@${vegaEmbedVersion}"></script>
</head>
<body>
<div id="vis"></div>
<script>
vegaEmbed('#vis', ${specJson}).catch(console.error);
</script>
</body>
</html>
`;
		}
		return undefined;
	}

	protected override async createWebview() {
		if (this._output.value) {
			throw new Error('Webview already created. Dispose the existing webview first.');
		}
		const output = await this._notebookOutputWebviewService.createNotebookOutputWebview({
			id: this.id,
			runtime: this._session,
			output: this._message,
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
