/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMessageOutput } from '../../languageRuntime/common/languageRuntimeService.js';


// Define rules to detect known preload content
const preloadRules = [
	{
		name: 'hvplot-preload',
		// All conditions must be met
		conditions: [
			(html: string) => html.includes('<script type="esms-options">'),
			(html: string) => html.includes('[data-root-id]'),
			(html: string) => html.includes('.cell-output-ipywidget-background'),
			(html: string) => !/<(img|svg|canvas)/i.test(html) // Lacks typical plot elements
		]
	},
	// Add other library-specific preload rules here
];

/**
 * Checks if the given HTML content matches any of the preload rules.
 * @param htmlContent - The HTML content to check.
 * @returns True if the content matches a preload rule, false otherwise.
 */
export function isWebviewPreloadMessage(htmlContent: string): boolean {
	for (const rule of preloadRules) {
		if (rule.conditions.every(condition => condition(htmlContent))) {
			return true;
		}
	}
	return false;
}

const MIME_TYPE_HOLOVIEWS_LOAD = 'application/vnd.holoviews_load.v0+json';
const MIME_TYPE_HOLOVIEWS_EXEC = 'application/vnd.holoviews_exec.v0+json';
const MIME_TYPE_BOKEH_EXEC = 'application/vnd.bokehjs_exec.v0+json';
const MIME_TYPE_BOKEH_LOAD = 'application/vnd.bokehjs_load.v0+json';
const MIME_TYPE_POSITRON_WEBVIEW_FLAG = 'application/positron-webview-load.v0+json';
const MIME_TYPE_PLOTLY = 'application/vnd.plotly.v1+json';
const MIME_TYPE_PLAIN = 'text/plain';
const MIME_TYPE_HTML = 'text/html';

const MIME_TYPES = {
	HOLOVIEWS_LOAD: MIME_TYPE_HOLOVIEWS_LOAD,
	HOLOVIEWS_EXEC: MIME_TYPE_HOLOVIEWS_EXEC,
	BOKEH_EXEC: MIME_TYPE_BOKEH_EXEC,
	BOKEH_LOAD: MIME_TYPE_BOKEH_LOAD,
	POSITRON_WEBVIEW_FLAG: MIME_TYPE_POSITRON_WEBVIEW_FLAG,
	PLOTLY: MIME_TYPE_PLOTLY,
	PLAIN: MIME_TYPE_PLAIN,
	HTML: MIME_TYPE_HTML
};

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



type WebviewContentType = 'display' | 'preload' | null;


/**
 * Determines if a set of notebook cell outputs contains mime types that require webview handling.
 * This is used to check if outputs need special webview processing, either for:
 * 1. Display messages that create new webviews (e.g. interactive plots)
 * 2. Replay messages that need to be stored for later playback in webviews
 *
 * @param outputs Array of output objects containing mime types to check
 * @returns The type of webview message ('display', 'preload') or null if not handled
 */
export function getWebviewMessageType(outputs: { mime: string }[]): WebviewContentType {
	const mimeTypes = outputs.map(output => output.mime);
	if (isWebviewDisplayMessage(mimeTypes)) {
		return 'display';
	}
	if (isWebviewReplayMessage(mimeTypes)) {
		return 'preload';
	}

	return null;
}
