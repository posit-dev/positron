/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IPositronPlotClient } from '../../positronPlots/common/positronPlots.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimeSession } from '../../runtimeSession/common/runtimeSessionService.js';

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

	/**
	 * Checks if a widget instance from a positron notebook exists for the given widget ID.
	 * Used to prevent duplicate widgets being created during retry operations.
	 *
	 * @param widgetId The unique widget/output ID
	 * @returns True if a widget instance exists for this ID
	 */
	hasPositronNotebookWidgetInstance(widgetId: string): boolean;

	/**
	 * Creates an IPyWidgets instance for a specific positron notebook widget output.
	 * Each widget receives its own isolated messaging channel for proper
	 * communication with the kernel.
	 *
	 * @param session The notebook session
	 * @param widgetId The unique widget/output ID
	 * @returns Disposable that cleans up the widget instance
	 */
	createPositronNotebookWidgetInstance(session: ILanguageRuntimeSession, widgetId: string): IDisposable;
}
