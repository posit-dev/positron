/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IPositronPlotClient } from '../../positronPlots/common/positronPlots.js';

export const POSITRON_HOLOVIEWS_ID = 'positronWebviewPreloadService';
export const MIME_TYPE_HOLOVIEWS_LOAD = 'application/vnd.holoviews_load.v0+json';
export const MIME_TYPE_HOLOVIEWS_EXEC = 'application/vnd.holoviews_exec.v0+json';
export const MIME_TYPE_BOKEH_EXEC = 'application/vnd.bokehjs_exec.v0+json';
export const MIME_TYPE_BOKEH_LOAD = 'application/vnd.bokehjs_load.v0+json';
export const MIME_TYPE_POSITRON_WEBVIEW_FLAG = 'application/positron-webview-load.v0+json';

export const IPositronWebviewPreloadService = createDecorator<IPositronWebviewPreloadService>(POSITRON_HOLOVIEWS_ID);

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
}
