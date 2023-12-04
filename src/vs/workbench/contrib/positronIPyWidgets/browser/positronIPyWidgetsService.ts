/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeService, ILanguageRuntime, RuntimeClientType, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageCommOpen, PositronOutputLocation, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Emitter, Event } from 'vs/base/common/event';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IViewsService } from 'vs/workbench/common/views';
import { IPositronIPyWidgetsService, IPositronIPyWidgetMetadata, IPyWidgetHtmlData } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { POSITRON_PLOTS_VIEW_ID } from 'vs/workbench/services/positronPlots/common/positronPlots';

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

	/** The emitter for the onDidEmitIPyWidget event */
	private readonly _onDidEmitIPyWidget = new Emitter<IPyWidgetClientInstance>();

	/** Creates the Positron plots service instance */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@IStorageService private _storageService: IStorageService,
		@IViewsService private _viewsService: IViewsService,
		@IPositronNotebookOutputWebviewService private _notebookOutputWebviewService: IPositronNotebookOutputWebviewService
	) {
		super();

		// Register for language runtime service startups
		this._register(this._languageRuntimeService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));
	}

	private registerIPyWidgetClient(widgetClient: IPyWidgetClientInstance) {

		// Add to our list of plots
		this._widgets.push(widgetClient);

		this._onDidEmitIPyWidget.fire(widgetClient);

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

					// Attempt to load the metadata for this widget from storage
					const storedMetadata = this._storageService.get(
						this.generateStorageKey(runtime.metadata.runtimeId, client.getClientId()),
						StorageScope.WORKSPACE);

					// If we have metadata, try to parse it
					if (storedMetadata) {
						try {
							const metadata = JSON.parse(storedMetadata) as IPositronIPyWidgetMetadata;
							widgetClients.push(new IPyWidgetClientInstance(client, metadata));
						} catch (error) {
							console.warn(`Error parsing widget metadata: ${error}`);
						}
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

				// Register the widget client
				const widgetClient = new IPyWidgetClientInstance(event.client, metadata);
				this.registerIPyWidgetClient(widgetClient);

				// Call the notebook output webview service method with combined data
				this.createWebviewWidgets(runtime, event.message);


				// TODO: the widget may need to be viewable in either the Plots or Viewer pane
				// Raise the Plots pane so the widget is visible.
				this._viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);
			}
		}));
	}

	private findPrimaryWidget(runtime: ILanguageRuntime): IPyWidgetClientInstance[] {
		// Primary widgets must match the current runtime ID, have no dependencies,
		// and be "viewable" (i.e. have a layout and dom_classes property)
		const matchingRuntimeWidgets = this._widgets.filter(widget => widget.metadata.runtime_id === runtime.metadata.runtimeId);
		const dependentWidgets = new Set<string>();
		matchingRuntimeWidgets.forEach(widget => {
			widget.dependencies.forEach(dependency => {
				dependentWidgets.add(dependency);
			});
		});
		const primaryWidgets = matchingRuntimeWidgets.filter(widget => {
			return !dependentWidgets.has(widget.id) && widget.isViewable();
		});
		return primaryWidgets;
	}

	private async createWebviewWidgets(runtime: ILanguageRuntime, message: ILanguageRuntimeMessageCommOpen) {
		// Combine our existing list of widgets
		// TODO: this is where we need to combine the widget data

		// log the full list of widgets
		console.log(`widgets: ${JSON.stringify(this.positronWidgetInstances.map(widget => {
			return {
				id: widget.id,
				runtime_id: widget.metadata.runtime_id,
				model_name: widget.metadata.widget_state.model_name,
			};
		}
		))}`);

		const htmlData = new IPyWidgetHtmlData(this.positronWidgetInstances);
		// TODO: Figure out which widget is the primary widget and add it to the viewspec
		console.log(`htmlData: ${JSON.stringify(htmlData)}`);
		console.log(`findPrimaryWidget: ${this.findPrimaryWidget(runtime).map(widget => widget.id)}`);

		const widgetMessage = {
			...message,
			output_location: PositronOutputLocation.Plot,
			resource_roots: undefined,
			kind: RuntimeOutputKind.IPyWidget,
			data: {},
		} as ILanguageRuntimeMessageOutput;

		const webview = await this._notebookOutputWebviewService.createNotebookOutputWebview(
			runtime, widgetMessage, htmlData);
		if (webview) {
			// TODO: do something with the webview?
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
	 * Generates a storage key for a widget's metadata.
	 *
	 * @param runtimeId The ID of the runtime that owns the widget.
	 * @param widgetId The ID of the widget itself.
	 */
	private generateStorageKey(runtimeId: string, widgetId: string): string {
		return `positron.ipywidget.${runtimeId}.${widgetId}`;
	}

	onDidEmitIPyWidget: Event<IPyWidgetClientInstance> = this._onDidEmitIPyWidget.event;

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
