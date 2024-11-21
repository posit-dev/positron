/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { MIME_TYPE_HOLOVIEWS_LOAD, MIME_TYPE_HOLOVIEWS_EXEC, MIME_TYPE_BOKEH_EXEC, MIME_TYPE_BOKEH_LOAD, MIME_TYPE_POSITRON_WEBVIEW_FLAG } from 'vs/workbench/services/positronWebviewPreloads/browser/positronWebviewPreloadService';


const webviewReplayMimeTypes = new Set([
	MIME_TYPE_HOLOVIEWS_LOAD,
	MIME_TYPE_HOLOVIEWS_EXEC,
	MIME_TYPE_BOKEH_EXEC,
	MIME_TYPE_BOKEH_LOAD,
	MIME_TYPE_POSITRON_WEBVIEW_FLAG
]);

/**
 * Check if a message represents a webview preload message.
 * @param mimeTypesOrMsg Message from language runtime or an array of mime types.
 * @returns True if the message is a webview preload message.
 */
export function isWebviewReplayMessage(mimeTypesOrMsg: ILanguageRuntimeMessageOutput | string[]): boolean {
	const mimeTypes = Array.isArray(mimeTypesOrMsg) ? mimeTypesOrMsg : Object.keys(mimeTypesOrMsg.data);
	return mimeTypes.some(key => webviewReplayMimeTypes.has(key));
}


const MIME_TYPE_HTML = 'text/html';
const MIME_TYPE_PLAIN = 'text/plain';

const displayMimeTypes = [
	MIME_TYPE_HOLOVIEWS_EXEC,
	MIME_TYPE_HTML,
	MIME_TYPE_PLAIN,
];

/**
 * Check if a message represents a webview display message.
 * @param mimeTypesOrMsg Message from language runtime or an array of mime types.
 * @returns True if the message is a webview display message.
 */
export function isWebviewDisplayMessage(mimeTypesOrMsg: string[] | ILanguageRuntimeMessageOutput): boolean {
	// Convert ILanguageRuntimeMessageOutput to string array of mime types if needed
	const mimeTypeArray = Array.isArray(mimeTypesOrMsg) ? mimeTypesOrMsg : Object.keys(mimeTypesOrMsg.data);

	// First check if it's a holoviews display message, then check if it's a bokeh display message.
	return displayMimeTypes.every(mime => mimeTypeArray.includes(mime)) ||
		mimeTypeArray.includes(MIME_TYPE_BOKEH_EXEC);
}
