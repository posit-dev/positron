/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';


export const POSITRON_IPYWIDGETS_SERVICE_ID = 'positronIPyWidgetsService';

export const IPositronIPyWidgetsService = createDecorator<IPositronIPyWidgetsService>(POSITRON_IPYWIDGETS_SERVICE_ID);

export interface IPyWidgetViewSpec {
	version_major: number;
	version_minor: number;
	model_id: string;
}

export interface IPyWidgetState {
	model_name: string;
	model_module: string;
	model_module_version: string;
	state: any;
}
export class IPyWidgetHtmlData {

	constructor(
		private _managerState: {
			version_major: number;
			version_minor: number;
			state: {
				[model_id: string]: IPyWidgetState;
			};
		},
		private _widgetViews: IPyWidgetViewSpec[]
	) {

	}

	addWidgetView(view: IPyWidgetViewSpec) {
		this._widgetViews.push(view);
	}

	get managerState(): string {
		return JSON.stringify(this._managerState);
	}

	get widgetViews(): string[] {
		return this._widgetViews.map(view => JSON.stringify(view));
	}
}

// TODO: Do we need this or can we use the
export interface IPositronIPyWidgetMetadata {
	id: string;
	runtime_id: string;
	widget_state: IPyWidgetState;
}

export interface IPositronIPyWidgetClient extends IDisposable {
	readonly id: string;
	readonly metadata: IPositronIPyWidgetMetadata;
}

/**
 * IPositronIPyWidgetsService interface.
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
