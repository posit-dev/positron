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

/**
 * MIME types used for webview content handling
 */
const MIME_TYPES = {
	HOLOVIEWS_LOAD: 'application/vnd.holoviews_load.v0+json',
	HOLOVIEWS_EXEC: 'application/vnd.holoviews_exec.v0+json',
	BOKEH_EXEC: 'application/vnd.bokehjs_exec.v0+json',
	BOKEH_LOAD: 'application/vnd.bokehjs_load.v0+json',
	POSITRON_WEBVIEW_FLAG: 'application/positron-webview-load.v0+json',
	PLOTLY: 'application/vnd.plotly.v1+json',
	PLAIN: 'text/plain',
	HTML: 'text/html',
	WIDGET_VIEW: 'application/vnd.jupyter.widget-view+json',
	WIDGET_STATE: 'application/vnd.jupyter.widget-state+json'
} as const;

/**
 * Set of MIME types that indicate content should be replayed in webviews
 */
const webviewReplayMimeTypes = new Set<string>([
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

/**
 * Checks if mime types represent a widget display.
 * @param mimeTypes Array of mime types to check
 * @returns True if contains widget MIME types
 */
export function isWidgetDisplayMessage(mimeTypes: string[]): boolean {
	return mimeTypes.includes(MIME_TYPES.WIDGET_VIEW);
}

/**
 * Determines if a set of notebook cell outputs contains mime types that require webview handling.
 * This is used to check if outputs need special webview processing, either for:
 * 1. Widget messages that create interactive widget webviews (e.g. ipywidgets)
 * 2. Display messages that create new webviews (e.g. interactive plots)
 * 3. Replay messages that need to be stored for later playback in webviews
 *
 * @param outputs Array of output objects containing mime types to check
 * @returns The type of webview message ('widget', 'display', 'preload') or null if not handled
 */
export function getWebviewMessageType(outputs: { mime: string }[]): 'widget' | 'display' | 'preload' | null {
	const mimeTypes = outputs.map(output => output.mime);

	// Check for widgets FIRST (highest priority)
	if (isWidgetDisplayMessage(mimeTypes)) {
		return 'widget';
	}

	if (isWebviewDisplayMessage(mimeTypes)) {
		return 'display';
	}
	if (isWebviewReplayMessage(mimeTypes)) {
		return 'preload';
	}

	return null;
}
