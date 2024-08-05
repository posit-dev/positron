/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

export const POSITRON_IPYWIDGETS_SERVICE_ID = 'positronIPyWidgetsService';
export const MIME_TYPE_WIDGET_STATE = 'application/vnd.jupyter.widget-state+json';
export const MIME_TYPE_WIDGET_VIEW = 'application/vnd.jupyter.widget-view+json';

export const IPositronIPyWidgetsService = createDecorator<IPositronIPyWidgetsService>(POSITRON_IPYWIDGETS_SERVICE_ID);

/**
 * IPositronIPyWidgetsService interface.
 */
export interface IPositronIPyWidgetsService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Notifies subscribers when a new plot client is created from IPyWidgets.
	 */
	readonly onDidCreatePlot: Event<IPositronPlotClient>;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;
}
