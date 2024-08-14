/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IOverlayWebview, IWebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';

export const POSITRON_NOTEBOOK_OUTPUT_WEBVIEW_SERVICE_ID = 'positronNotebookOutputWebview';

export const IPositronNotebookOutputWebviewService =
	createDecorator<IPositronNotebookOutputWebviewService>(
		POSITRON_NOTEBOOK_OUTPUT_WEBVIEW_SERVICE_ID);

export interface INotebookOutputWebview<WType extends IOverlayWebview | IWebviewElement = IOverlayWebview> extends IDisposable {
	/** The ID of the notebook output */
	id: string;

	/** The ID of the runtime session that emitted (and owns) the output */
	sessionId: string;

	/** The webview containing the output's content */
	webview: WType;

	/** Fired when the content completes rendering */
	onDidRender: Event<void>;

	/**
	 * Optional method to render the output in the webview rather than doing so
	 * directly in the HTML content
	 */
	render?(): void;
}

export enum WebviewType {
	Overlay,
	Standard
}

export interface IPositronNotebookOutputWebviewService {

	// Required for dependency injection
	readonly _serviceBrand: undefined;

	/**
	 * Create a new notebook output webview from an output message.
	 *
	 * @param runtime The runtime that emitted the output
	 * @param output The message containing the contents to be rendered in the webview.
	 * @param viewType The view type of the notebook e.g 'jupyter-notebook', if known. Used to
	 *  select the required notebook preload scripts for the webview.
	 * @returns A promise that resolves to the new webview, or undefined if the
	 *   output does not have a suitable renderer.
	 */
	createNotebookOutputWebview(
		runtime: ILanguageRuntimeSession,
		output: ILanguageRuntimeMessageOutput,
		viewType?: string,
	): Promise<INotebookOutputWebview | undefined>;

	/**
	 * Create a new notebook output webview from a series of output messages.
	 *
	 * This is useful for situations where a plot may have dependencies that are provided by
	 * separate messages.
	 *
	 * @param runtime The runtime that emitted the output
	 * @param outputs The messages to be sent to the webview. The final message that triggered the
	 * plotting should be the final element of the array.
	 * @param viewType The view type of the notebook e.g 'jupyter-notebook', if known. Used to
	 *  select the required notebook preload scripts for the webview.
	 */
	createMultiOutputWebview(
		runtime: ILanguageRuntimeSession,
		outputs: ILanguageRuntimeMessageOutput[],
		viewType?: string,
	): Promise<INotebookOutputWebview | undefined>;

	/**
	 * Create a new raw HTML output webview.
	 *
	 * @param opts The options for the webview
	 * @param opts.id A unique ID for this webview; typically the ID of the message
	 *  that created it.
	 * @param opts.runtimeOrSessionId The runtime that owns this webview. Can also be a string of the ID of the runtime.
	 * @param opts.html The HTML content to render in the webview.
	 * @param opts.webviewType The type of webview to create.
	 * @returns A promise that resolves to the new webview of the desired type.
	 */
	createRawHtmlOutput<WType extends WebviewType>(opts: {
		id: string;
		html: string;
		webviewType: WType;
		runtimeOrSessionId: ILanguageRuntimeSession | string;
	}): Promise<
		INotebookOutputWebview<WType extends WebviewType.Overlay ? IOverlayWebview : IWebviewElement>
	>;
}

