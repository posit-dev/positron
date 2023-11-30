/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';

export const POSITRON_IPYWIDGETS_SERVICE_ID = 'positronIPyWidgetsService';

export const IPositronIPyWidgetsService = createDecorator<IPositronIPyWidgetsService>(POSITRON_IPYWIDGETS_SERVICE_ID);

export interface IPositronIPyWidgetMetadata {
	id: string;
	runtime_id: string;
	model_name: string;
	model_module: string;
	model_module_version: string;
	state: any; // TODO: create an interface for this state
}

export interface IPositronIPyWidgetClient extends IDisposable {
	readonly id: string;
	readonly metadata: IPositronIPyWidgetMetadata;
}

/**
 * IPositronPlotsService interface.
 */
export interface IPositronIPyWidgetsService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Gets the individual IPyWidget client instances.
	 */
	readonly positronWidgetInstances: IPositronIPyWidgetClient[];

	/**
	 * Notifies subscribers when a new IPyWidget instance is created.
	 */
	readonly onDidEmitIPyWidget: Event<IPositronIPyWidgetClient>;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;
}
