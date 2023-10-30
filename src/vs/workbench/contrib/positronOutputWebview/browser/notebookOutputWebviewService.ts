/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';
import { ILanguageRuntime, ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Event } from 'vs/base/common/event';

export const POSITRON_NOTEBOOK_OUTPUT_WEBVIEW_SERVICE_ID = 'positronNotebookOutputWebview';

export const IPositronNotebookOutputWebviewService =
	createDecorator<IPositronNotebookOutputWebviewService>(
		POSITRON_NOTEBOOK_OUTPUT_WEBVIEW_SERVICE_ID);

export interface INotebookOutputWebview {
	/** The ID of the notebook output */
	id: string;

	/** The ID of the runtime that emitted (and owns) the output */
	runtimeId: string;

	/** The webview containing the output's content */
	webview: IOverlayWebview;

	/** Fired when the content completes rendering */
	onDidRender: Event<void>;
}

export interface IPositronNotebookOutputWebviewService {

	// Required for dependency injection
	readonly _serviceBrand: undefined;

	/**
	 * Create a new notebook output webview from an output message.
	 *
	 * @param runtime The runtime that emitted the output
	 * @param output The message containing the contents to be rendered in the webview.
	 * @returns A promise that resolves to the new webview, or undefined if the
	 *   output does not have a suitable renderer.
	 */
	createNotebookOutputWebview(
		runtime: ILanguageRuntime,
		output: ILanguageRuntimeMessageOutput): Promise<INotebookOutputWebview | undefined>;
}

