/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeService, ILanguageRuntime, RuntimeClientType, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageCommOpen, PositronOutputLocation, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Emitter, Event } from 'vs/base/common/event';
import { IPositronIPyWidgetsService, IPositronIPyWidgetMetadata, IPyWidgetHtmlData } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';

export interface IPositronIPyWidgetCommOpenData {
	state: {
		// required widget properties
		_model_module: string;
		_model_module_version: string;
		_model_name: string;
		_view_module: string;
		_view_module_version: string;
		_view_name: string;
		_view_count: number;
		// additional properties depending on the widget
		[key: string]: any;
	};
	buffer_paths: string[];
}
export class PositronIPyWidgetsService extends Disposable implements IPositronIPyWidgetsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** The list of IPyWidgets. */
	private readonly _widgets: IPyWidgetClientInstance[] = [];

	private readonly _primaryWidgets: Set<string> = new Set<string>();
	private readonly _secondaryWidgets: Set<string> = new Set<string>();

	/** The emitter for the onDidCreatePlot event */
	private readonly _onDidCreatePlot = new Emitter<WebviewPlotClient>();

	/** Creates the Positron plots service instance */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@IPositronNotebookOutputWebviewService private _notebookOutputWebviewService: IPositronNotebookOutputWebviewService
	) {
		super();

		// Register for language runtime service startups
		this._register(this._languageRuntimeService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));
	}

	private registerIPyWidgetClient(widgetClient: IPyWidgetClientInstance) {

		// Add to our list of widgets
		this._widgets.push(widgetClient);

		// Update the list of primary widgets whenever a new widget comes in
		this.updatePrimaryWidgets(widgetClient);

		// Remove the widget from our list when it is closed
		widgetClient.onDidClose(() => {
			const index = this._widgets.indexOf(widgetClient);
			if (index >= 0) {
				this._widgets.splice(index, 1);
			}
		});

		// Dispose the widget client when this service is disposed
		this._register(widgetClient);
	}

	private attachRuntime(runtime: ILanguageRuntime) {
		// Get the list of existing widget clients; these are expected in the
		// case of reconnecting to a running language runtime
		runtime.listClients(RuntimeClientType.IPyWidget).then(clients => {
			const widgetClients: Array<IPyWidgetClientInstance> = [];
			clients.forEach((client) => {
				if (client.getClientType() === RuntimeClientType.IPyWidget) {
					if (this.hasWidget(runtime.metadata.runtimeId, client.getClientId())) {
						return;
					}
				} else {
					console.warn(
						`Unexpected client type ${client.getClientType()} ` +
						`(expected ${RuntimeClientType.IPyWidget})`);
				}
			});

			widgetClients.forEach((client) => {
				this.registerIPyWidgetClient(client);
			});
		});

		this._register(runtime.onDidCreateClientInstance((event) => {
			if (event.client.getClientType() === RuntimeClientType.IPyWidget) {
				const clientId = event.client.getClientId();

				// Check to see if we we already have a widget client for this
				// client ID. If so, we don't need to do anything.
				if (this.hasWidget(runtime.metadata.runtimeId, clientId)) {
					return;
				}

				const data = event.message.data as IPositronIPyWidgetCommOpenData;

				// Create the metadata object
				const metadata: IPositronIPyWidgetMetadata = {
					id: clientId,
					runtime_id: runtime.metadata.runtimeId,
					widget_state: {
						model_name: data.state._model_name,
						model_module: data.state._model_module,
						model_module_version: data.state._model_module_version,
						state: data.state
					}
				};

				// Register the widget client and update the list of primary widgets
				const widgetClient = new IPyWidgetClientInstance(event.client, metadata);
				this.registerIPyWidgetClient(widgetClient);

				// Combine the widget data, and then create a webview for it
				this.createWebviewWidgets(runtime, event.message);
			}
		}));
	}

	private updatePrimaryWidgets(latestWidget: IPyWidgetClientInstance): void {
		// A widget is primary if no other widgets are dependent on it,
		// and they are "viewable" (i.e. they have both a layout and dom_classes property)
		latestWidget.dependencies.forEach(dependency => {
			// If the widget has a dependency, add it to the secondary list and remove from the primary list
			this._secondaryWidgets.add(dependency);
			this._primaryWidgets.delete(dependency);
		});
		if (latestWidget.isViewable() && !this._secondaryWidgets.has(latestWidget.id)) {
			this._primaryWidgets.add(latestWidget.id);
		}
	}

	private async createWebviewWidgets(runtime: ILanguageRuntime, message: ILanguageRuntimeMessageCommOpen) {
		const latestWidgetId = message.comm_id;

		if (!this._primaryWidgets.has(latestWidgetId)) {
			return;
		}
		// Combine our existing list of widgets into a single WebviewPlotClient
		const htmlData = new IPyWidgetHtmlData(this.positronWidgetInstances);

		this._primaryWidgets.forEach(widgetId => {
			htmlData.addWidgetView(widgetId);
		});

		const widgetMessage = {
			...message,
			output_location: PositronOutputLocation.Plot,
			kind: RuntimeOutputKind.IPyWidget,
			data: htmlData.data,
		} as ILanguageRuntimeMessageOutput;

		const webview = await this._notebookOutputWebviewService.createNotebookOutputWebview(
			runtime, widgetMessage);
		if (webview) {
			const plotClient = new WebviewPlotClient(webview, widgetMessage);
			this._onDidCreatePlot.fire(plotClient);
		}
	}

	/**
	 * Checks to see whether the service has a widget with the given ID.
	 *
	 * @param runtimeId The runtime ID that generated the widget.
	 * @param widgetId The widget's unique ID.
	 */
	private hasWidget(runtimeId: string, widgetId: string): boolean {
		return this._widgets.some(widget =>
			widget.metadata.runtime_id === runtimeId &&
			widget.metadata.id === widgetId);
	}

	/**
	 * Remove all widget clients
	 */
	removeAllWidgets(): void {
		this._widgets.forEach(widget => {
			widget.dispose();
		});

		// Clear the list of widgets
		this._widgets.length = 0;
	}

	onDidCreatePlot: Event<WebviewPlotClient> = this._onDidCreatePlot.event;

	// Gets the individual widget client instances.
	get positronWidgetInstances(): IPyWidgetClientInstance[] {
		return this._widgets;
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}
