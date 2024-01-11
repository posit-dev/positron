/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * A Positron plot instance that is backed by a webview.
 */
export class WidgetPlotClient extends WebviewPlotClient {

	/**
	 * Creates a new WebviewPlotClient, which wraps a notebook output webview in
	 * an object that can be displayed in the Plots pane.
	 *
	 * @param webview The webview to wrap.
	 * @param message The output message from which the webview was created.
	 */
	constructor(webview: INotebookOutputWebview,
		message: ILanguageRuntimeMessageOutput,
		// @ts-ignore: unused parameter
		private readonly _widgets: IPyWidgetClientInstance[]) {
		super(webview, message);

		// Don't register the widget to the plot client, since it's possible and valid for a widget
		// to outlive a plot client, or even to be shared by multiple plot clients.
	}
}
