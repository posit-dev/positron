/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronPlotClient } from '../../positronPlots/common/positronPlots.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';

export const POSITRON_HOLOVIEWS_ID = 'positronWebviewPreloadService';
export const MIME_TYPE_HOLOVIEWS_LOAD = 'application/vnd.holoviews_load.v0+json';
export const MIME_TYPE_HOLOVIEWS_EXEC = 'application/vnd.holoviews_exec.v0+json';
export const MIME_TYPE_BOKEH_EXEC = 'application/vnd.bokehjs_exec.v0+json';
export const MIME_TYPE_BOKEH_LOAD = 'application/vnd.bokehjs_load.v0+json';
export const MIME_TYPE_POSITRON_WEBVIEW_FLAG = 'application/positron-webview-load.v0+json';
export const MIME_TYPE_PLOTLY = 'application/vnd.plotly.v1+json';
export const MIME_TYPE_PLAIN = 'text/plain';
export const MIME_TYPE_HTML = 'text/html';

export const MIME_TYPES = {
	HOLOVIEWS_LOAD: MIME_TYPE_HOLOVIEWS_LOAD,
	HOLOVIEWS_EXEC: MIME_TYPE_HOLOVIEWS_EXEC,
	BOKEH_EXEC: MIME_TYPE_BOKEH_EXEC,
	BOKEH_LOAD: MIME_TYPE_BOKEH_LOAD,
	POSITRON_WEBVIEW_FLAG: MIME_TYPE_POSITRON_WEBVIEW_FLAG,
	PLOTLY: MIME_TYPE_PLOTLY,
	PLAIN: MIME_TYPE_PLAIN,
	HTML: MIME_TYPE_HTML
};

export const IPositronWebviewPreloadService = createDecorator<IPositronWebviewPreloadService>(POSITRON_HOLOVIEWS_ID);


/**
 * The results of a notebook output message that may have a webview preload. Either a preload
 * message or a display message. If it is a display message, the webview is a promise of a
 * disposable container of a webview.
 */
export type NotebookPreloadOutputResults =
	| { preloadMessageType: 'preload' }
	| {
		preloadMessageType: 'display';
		// We stub out a basic approximation here to avoid jumping through hoops for import ordering
		// rules.
		webview: Promise<{
			readonly id: string;
			readonly sessionId: string;
			dispose(): void;
			readonly onDidRender: Event<void>;
		}>;
	};

export interface IPositronWebviewPreloadService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;

	/**
	 * Notifies subscribers when a new plot client is created from HoloViews.
	 */
	readonly onDidCreatePlot: Event<IPositronPlotClient>;

	/**
	 * Session info (used for testing)
	 */
	sessionInfo(sessionId: string): { numberOfMessages: number } | null;


	/**
	 * Add a notebook to the known list for replay of messages when creating webviews.
	 * @param instance Instance for the notebook
	 */
	attachNotebookInstance(instance: IPositronNotebookInstance): void;

	/**
	 * Add output from a notebook cell and process it for webview preloads
	 */
	addNotebookOutput(
		opts:
			{
				instance: IPositronNotebookInstance;
				outputId: string;
				outputs: { mime: string; data: VSBuffer }[];
			}
	): NotebookPreloadOutputResults | undefined;
}
