/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMessageOutput } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { MIME_TYPES } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';

const webviewReplayMimeTypes = new Set([
	MIME_TYPES.HOLOVIEWS_LOAD,
	MIME_TYPES.HOLOVIEWS_EXEC,
	MIME_TYPES.BOKEH_EXEC,
	MIME_TYPES.BOKEH_LOAD,
	MIME_TYPES.POSITRON_WEBVIEW_FLAG
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


/**
 * Checks if the given mime types represent a holoviews display message bundle.
 * @param mimeTypes Array of mime types to check
 * @returns True if the mime types contain all required holoviews display bundle types
 */
function isHoloviewsDisplayBundle(mimeTypes: Set<string>): boolean {

	return mimeTypes.has(MIME_TYPES.HOLOVIEWS_EXEC) &&
		mimeTypes.has(MIME_TYPES.HTML) &&
		mimeTypes.has(MIME_TYPES.PLAIN);
}

/**
 * Check if a message represents a webview display message.
 * @param mimeTypesOrMsg Message from language runtime or an array of mime types.
 * @returns True if the message is a webview display message.
 */
export function isWebviewDisplayMessage(mimeTypesOrMsg: string[] | ILanguageRuntimeMessageOutput): boolean {
	// Convert ILanguageRuntimeMessageOutput to string array of mime types if needed
	const mimeTypeSet = new Set(Array.isArray(mimeTypesOrMsg) ? mimeTypesOrMsg : Object.keys(mimeTypesOrMsg.data));

	// First check if it's a holoviews display message, then check if it's a bokeh display message.
	return isHoloviewsDisplayBundle(mimeTypeSet) ||
		mimeTypeSet.has(MIME_TYPES.BOKEH_EXEC) ||
		mimeTypeSet.has(MIME_TYPES.PLOTLY);
}
