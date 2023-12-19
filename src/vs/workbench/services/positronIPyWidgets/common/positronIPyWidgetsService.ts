/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

export const POSITRON_IPYWIDGETS_SERVICE_ID = 'positronIPyWidgetsService';
export const MIME_TYPE_WIDGET_STATE = 'application/vnd.jupyter.widget-state+json';
export const MIME_TYPE_WIDGET_VIEW = 'application/vnd.jupyter.widget-view+json';

export const IPositronIPyWidgetsService = createDecorator<IPositronIPyWidgetsService>(POSITRON_IPYWIDGETS_SERVICE_ID);

export interface IPyWidgetViewSpec {
	version_major: number;
	version_minor: number;
	model_id: string;
}

interface IPyWidgetState {
	model_name: string;
	model_module: string;
	model_module_version: string;
	state: Record<string, any>;
}
export class IPyWidgetHtmlData {

	private _managerState: {
		version_major: number;
		version_minor: number;
		state: {
			[model_id: string]: IPyWidgetState;
		};
	};

	private _widgetViews: IPyWidgetViewSpec[] = [];

	constructor(
		widgets: IPositronIPyWidgetClient[]
	) {
		this._managerState = {
			// We only support ipywidget state schema version 2.0
			// https://github.com/jupyter-widgets/ipywidgets/blob/52663ac472c38ba12575dfb4979fa2d250e79bc3/packages/schema/v2/state.schema.json
			version_major: 2,
			version_minor: 0,
			state: {}
		};

		widgets.forEach(widget => {
			this._managerState.state[widget.metadata.id] = {
				model_name: widget.metadata.widget_state.model_name,
				model_module: widget.metadata.widget_state.model_module,
				model_module_version: widget.metadata.widget_state.model_module_version,
				state: widget.metadata.widget_state.state
			};
		});
	}

	addWidgetView(model_id: string) {
		// We only support ipywidget view schema version 2.0
		// https://github.com/jupyter-widgets/ipywidgets/blob/52663ac472c38ba12575dfb4979fa2d250e79bc3/packages/schema/v2/view.schema.json
		const view = {
			version_major: 2,
			version_minor: 0,
			model_id: model_id
		};
		this._widgetViews.push(view);
	}

	get managerState(): string {
		return JSON.stringify(this._managerState);
	}

	get widgetViews(): string {
		return JSON.stringify(this._widgetViews);
	}

	get data(): Record<string, string> {
		return {
			[MIME_TYPE_WIDGET_STATE]: this.managerState,
			[MIME_TYPE_WIDGET_VIEW]: this.widgetViews,
		};
	}
}

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
	 * Notifies subscribers when a new plot client is created from IPyWidgets.
	 */
	readonly onDidCreatePlot: Event<IPositronPlotClient>;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;
}
