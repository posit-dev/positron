/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IOverlayWebview, IWebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';

export const POSITRON_NOTEBOOK_OUTPUT_WEBVIEW_SERVICE_ID = 'positronNotebookOutputWebview';

export const IPositronNotebookOutputWebviewService =
	createDecorator<IPositronNotebookOutputWebviewService>(
		POSITRON_NOTEBOOK_OUTPUT_WEBVIEW_SERVICE_ID);

export interface INotebookOutputWebview extends IDisposable {
	/** The ID of the notebook output */
	id: string;

	/** The ID of the runtime session that emitted (and owns) the output */
	sessionId: string;

	/** The webview containing the output's content */
	webview: IOverlayWebview | IWebviewElement;

	/** The type of webview, used for later type assertions */
	webviewType: WebviewType;

	/** Fired when the content completes rendering */
	onDidRender: Event<void>;
}

export interface INotebookOutputOverlayWebview extends INotebookOutputWebview {
	webview: IOverlayWebview;
	webviewType: WebviewType.Overlay;
}

export interface INotebookOutputStandardWebview extends INotebookOutputWebview {
	webview: IWebviewElement;
	webviewType: WebviewType.Standard;
}

export enum WebviewType {
	Overlay = 'overlay',
	Standard = 'standard'
}

export interface IPositronNotebookOutputWebviewService {

	// Required for dependency injection
	readonly _serviceBrand: undefined;

	/**
	 * Create a new notebook output webview from an output message.
	 *
	 * @param id A unique ID for this webview; typically the ID of the message
	 *  that created it.
	 * @param runtime The runtime that emitted the output
	 * @param output The message containing the contents to be rendered in the webview.
	 * @param viewType The view type of the notebook e.g 'jupyter-notebook', if known. Used to
	 *  select the required notebook preload scripts for the webview.
	 * @returns A promise that resolves to the new webview, or undefined if the
	 *   output does not have a suitable renderer.
	 */
	createNotebookOutputWebview(
		opts: {
			id: string;
			runtime: ILanguageRuntimeSession;
			output: ILanguageRuntimeMessageOutput;
			viewType?: string;
			webviewType: WebviewType;
		}
	): Promise<INotebookOutputWebview | undefined>;

	/**
	 * Create a new notebook output webview from a series of output messages.
	 *
	 * This is useful for situations where a plot may have dependencies that are provided by
	 * separate messages.
	 *
	 * @param opts.runtimeId Unique ID for the runtime that emitted the output
	 * @param opts.preReqMessages The messages linked to the final display output message that load the
	 * required dependencies.
	 * @param opts.displayMessage The message that triggered the plotting.
	 * @param opts.viewType The view type of the notebook e.g 'jupyter-notebook', if known. Used to
	 *  select the required notebook preload scripts for the webview.
	 */
	createMultiMessageWebview(opts:
		{
			runtimeId: string;
			preReqMessages: ILanguageRuntimeMessageWebOutput[];
			displayMessage: ILanguageRuntimeMessageWebOutput;
			viewType?: string;
			webviewType: WebviewType;
		}): Promise<INotebookOutputWebview | undefined>;

	/**
	 * Create a new raw HTML output webview.
	 *
	 * @param opts The options for the webview
	 * @param opts.id A unique ID for this webview; typically the ID of the message
	 *  that created it.
	 * @param opts.runtimeOrSessionId The runtime that owns this webview. Can also be a string of the ID of the runtime.
	 * @param opts.html The HTML content to render in the webview.
	 * @returns A promise that resolves to the new webview of the desired type.
	 */
	createRawHtmlOutput(opts: {
		id: string;
		html: string;
		runtimeOrSessionId: ILanguageRuntimeSession | string;
		webviewType: WebviewType;
	}): Promise<INotebookOutputWebview>;
}

