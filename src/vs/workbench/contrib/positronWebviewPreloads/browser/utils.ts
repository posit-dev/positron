/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { MIME_TYPE_HOLOVIEWS_LOAD, MIME_TYPE_HOLOVIEWS_EXEC, MIME_TYPE_BOKEH_EXEC, MIME_TYPE_BOKEH_LOAD, MIME_TYPE_POSITRON_WEBVIEW_FLAG } from 'vs/workbench/services/positronWebviewPreloads/common/positronWebviewPreloadService';


const webviewReplayMimeTypes = new Set([
	MIME_TYPE_HOLOVIEWS_LOAD,
	MIME_TYPE_HOLOVIEWS_EXEC,
	MIME_TYPE_BOKEH_EXEC,
	MIME_TYPE_BOKEH_LOAD,
	MIME_TYPE_POSITRON_WEBVIEW_FLAG
]);

/**
 * Check if a message represents a webview preload message.
 * @param msg Message from language runtime.
 * @returns True if the message is a webview preload message.
 */
export function isWebviewReplayMessage(msg: ILanguageRuntimeMessageOutput): boolean {
	return Object.keys(msg.data).some(key => webviewReplayMimeTypes.has(key));
}
