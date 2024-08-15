/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

export const POSITRON_HOLOVIEWS_ID = 'positronHoloViewsService';
export const MIME_TYPE_HOLOVIEWS_LOAD = 'application/vnd.holoviews_load.v0+json';
export const MIME_TYPE_HOLOVIEWS_EXEC = 'application/vnd.holoviews_exec.v0+json';

export const IPositronHoloViewsService = createDecorator<IPositronHoloViewsService>(POSITRON_HOLOVIEWS_ID);

/**
 * IPositronHoloViewsService interface.
 */
export interface IPositronHoloViewsService {
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
