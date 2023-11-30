/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeService, ILanguageRuntime, RuntimeClientType, ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Emitter, Event } from 'vs/base/common/event';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IViewsService } from 'vs/workbench/common/views';
import { IPositronIPyWidgetsService, IPositronIPyWidgetMetadata } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { POSITRON_PLOTS_VIEW_ID } from 'vs/workbench/services/positronPlots/common/positronPlots';

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
		@IViewsService private _viewsService: IViewsService
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

		this._register(runtime.onDidReceiveRuntimeMessageOutput(async (message: ILanguageRuntimeMessageOutput) => {
			if (this.hasWidget(runtime.metadata.runtimeId, message.id)) {
				return;
			}

			// Raise the Plots pane so the widget is visible.
			// TODO: widget may go to either the Plots pane or the Viewer pane
			this._viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);

		}));
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
