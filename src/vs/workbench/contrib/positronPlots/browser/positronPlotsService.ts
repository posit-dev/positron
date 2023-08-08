/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPlotMetadata, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntime, ILanguageRuntimeMessageOutput, ILanguageRuntimeService, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotsService, POSITRON_PLOTS_VIEW_ID, PositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { Emitter, Event } from 'vs/base/common/event';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';
import { IStorageService, StorageTarget, StorageScope } from 'vs/platform/storage/common/storage';
import { IViewsService } from 'vs/workbench/common/views';

/** The maximum number of recent executions to store. */
const MaxRecentExecutions = 10;

/**
 * PositronPlotsService class.
 */
export class PositronPlotsService extends Disposable implements IPositronPlotsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** The list of Positron plots. */
	private readonly _plots: PositronPlotClient[] = [];

	/** The emitter for the onDidReplacePlots event */
	private readonly _onDidReplacePlots = new Emitter<PositronPlotClient[]>();

	/** The emitter for the onDidEmitPlot event */
	private readonly _onDidEmitPlot = new Emitter<PositronPlotClient>();

	/** The emitter for the onDidSelectPlot event */
	private readonly _onDidSelectPlot = new Emitter<string>();

	/** The emitter for the onDidRemovePlot event */
	private readonly _onDidRemovePlot = new Emitter<string>();

	/** The ID Of the currently selected plot, if any */
	private _selectedPlotId: string | undefined;

	/**
	 * A map of recently executed code; the map is from the parent ID to the
	 * code executed. We keep around the last 10 executions so that when a plot
	 * is emitted, we can generally find the code that generated it and display
	 * it in the plot view.
	 */
	private readonly _recentExecutions = new Map<string, string>();
	private readonly _recentExecutionIds = new Array<string>();

	/** Creates the Positron plots service instance */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@IStorageService private _storageService: IStorageService,
		@IViewsService private _viewsService: IViewsService) {
		super();

		// Register for language runtime service startups
		this._register(this._languageRuntimeService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		// Listen for plots being selected and update the selected plot ID
		this._register(this._onDidSelectPlot.event((id) => {
			this._selectedPlotId = id;
		}));
	}

	/**
	 * Attaches to a language runtime.
	 *
	 * @param runtime The language runtime to attach to.
	 */
	private attachRuntime(runtime: ILanguageRuntime) {
		// Get the list of existing plot clients; these are expected in the
		// case of reconnecting to a running language runtime, and represent
		// the user's active set of plot objects.
		runtime.listClients(RuntimeClientType.Plot).then(clients => {
			const plotClients: Array<PlotClientInstance> = [];
			clients.forEach((client) => {
				if (client.getClientType() === RuntimeClientType.Plot) {
					// Check to see if we we already have a plot client for this
					// client ID. If so, we don't need to do anything.
					if (this.hasPlot(runtime.metadata.runtimeId, client.getClientId())) {
						return;
					}

					// Attempt to load the metadata for this plot from storage
					const storedMetadata = this._storageService.get(
						this.generateStorageKey(runtime.metadata.runtimeId, client.getClientId()),
						StorageScope.WORKSPACE);

					// If we have metadata, try to parse it and register the plot
					let registered = false;
					if (storedMetadata) {
						try {
							const metadata = JSON.parse(storedMetadata) as IPositronPlotMetadata;
							plotClients.push(new PlotClientInstance(client, metadata));
							registered = true;
						} catch (error) {
							console.warn(`Error parsing plot metadata: ${error}`);
						}
					}
					// If we don't have metadata, register the plot with a default metadata object
					if (!registered) {
						const metadata: IPositronPlotMetadata = {
							created: Date.now(),
							id: client.getClientId(),
							runtime_id: runtime.metadata.runtimeId,
							parent_id: '',
							code: '',
						};
						plotClients.push(new PlotClientInstance(client, metadata));
					}
				} else {
					console.warn(
						`Unexpected client type ${client.getClientType()} ` +
						`(expected ${RuntimeClientType.Plot})`);
				}
			});

			// If we have no plot clients, we're done
			if (plotClients.length === 0) {
				return;
			}

			// Before we start registering plots, take note of whether we have
			// any plots already registered.
			const wasEmpty = this._plots.length === 0;

			// Register each plot client with the plots service, but don't fire the
			// events.
			plotClients.forEach((client) => {
				this.registerPlotClient(client, false);
			});

			// Re-sort the plots by creation time since we may have added new ones that are
			// out of order.
			this._plots.sort((a, b) => a.metadata.created - b.metadata.created);

			// Fire the onDidReplacePlots event
			this._onDidReplacePlots.fire(this._plots);

			// If we had no plots before, select the first one
			if (wasEmpty && this._plots.length > 0) {
				this.selectPlot(this._plots[0].id);
			}
		});

		this._register(runtime.onDidReceiveRuntimeMessageInput((message) => {
			// Add this code to the recent executions map. If the map is
			// already at the maximum size, remove the oldest entry.
			this._recentExecutionIds.push(message.parent_id);
			if (this._recentExecutionIds.length > MaxRecentExecutions) {
				const id = this._recentExecutionIds.shift();
				if (id) {
					this._recentExecutions.delete(id);
				}
			}
			this._recentExecutions.set(message.parent_id, message.code);
		}));

		// Listen for new dynamic plots being emitted, and register each one
		// with the plots service.
		this._register(runtime.onDidCreateClientInstance((event) => {
			if (event.client.getClientType() === RuntimeClientType.Plot) {
				const clientId = event.client.getClientId();

				// Check to see if we we already have a plot client for this
				// client ID. If so, we don't need to do anything.
				if (this.hasPlot(runtime.metadata.runtimeId, clientId)) {
					return;
				}

				// Get the code that generated this plot, if we have it
				const code = this._recentExecutions.has(event.message.parent_id) ?
					this._recentExecutions.get(event.message.parent_id)! : '';

				// Create the metadata object
				const metadata: IPositronPlotMetadata = {
					created: Date.parse(event.message.when),
					id: clientId,
					runtime_id: runtime.metadata.runtimeId,
					parent_id: event.message.parent_id,
					code,
				};

				// Save the metadata to storage so that we can restore it when
				// the plot is reconnected.
				this._storageService.store(
					this.generateStorageKey(metadata.runtime_id, metadata.id),
					JSON.stringify(metadata),
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);

				// Register the plot client
				const plotClient = new PlotClientInstance(event.client, metadata);
				this.registerPlotClient(plotClient, true);

				// Raise the Plots pane so the plot is visible
				this._viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);
			}
		}));

		// Listen for static plots being emitted, and register each one with
		// the plots service.
		this._register(runtime.onDidReceiveRuntimeMessageOutput((message) => {
			// Check to see if we we already have a plot client for this
			// message ID. If so, we don't need to do anything.
			if (this.hasPlot(runtime.metadata.runtimeId, message.id)) {
				return;
			}

			const code = this._recentExecutions.has(message.parent_id) ?
				this._recentExecutions.get(message.parent_id) : '';
			const imageKey = Object.keys(message.data).find(key => key.startsWith('image/'));
			if (imageKey) {
				this.registerStaticPlot(runtime.metadata.runtimeId, message, code);
			}
		}));
	}

	/**
	 * Creates a new plot client instance wrapper and registers it with the
	 * service.
	 *
	 * @param plotClient The plot client instance to wrap.
	 * @param fireEvents Whether to fire events for this plot client.
	 */
	private registerPlotClient(plotClient: PlotClientInstance, fireEvents: boolean) {

		// Add to our list of plots
		this._plots.push(plotClient);

		// Fire events for this plot if requested
		if (fireEvents) {
			this._onDidEmitPlot.fire(plotClient);
			this._onDidSelectPlot.fire(plotClient.id);
		}

		// Remove the plot from our list when it is closed
		plotClient.onDidClose(() => {
			const index = this._plots.indexOf(plotClient);
			if (index >= 0) {
				this._plots.splice(index, 1);
			}
			// Clear the plot's metadata from storage
			this._storageService.remove(
				this.generateStorageKey(plotClient.metadata.runtime_id, plotClient.metadata.id),
				StorageScope.WORKSPACE);
		});

		// Dispose the plot client when this service is disposed (we own this
		// object)
		this._register(plotClient);
	}

	/**
	 * Creates a new static plot client instance and registers it with the
	 * service.
	 *
	 * @param message The message containing the static plot data.
	 * @param code The code that generated the plot, if available.
	 */
	private registerStaticPlot(
		runtimeId: string,
		message: ILanguageRuntimeMessageOutput,
		code?: string) {
		const client = new StaticPlotClient(runtimeId, message, code);
		this._plots.unshift(client);
		this._onDidEmitPlot.fire(client);
		this._onDidSelectPlot.fire(client.id);
		this._register(client);
	}

	onDidEmitPlot: Event<PositronPlotClient> = this._onDidEmitPlot.event;
	onDidSelectPlot: Event<string> = this._onDidSelectPlot.event;
	onDidRemovePlot: Event<string> = this._onDidRemovePlot.event;
	onDidReplacePlots: Event<PositronPlotClient[]> = this._onDidReplacePlots.event;

	// Gets the individual plot instances.
	get positronPlotInstances(): PositronPlotClient[] {
		return this._plots;
	}

	// Gets the ID of the currently selected plot.
	get selectedPlotId(): string | undefined {
		return this._selectedPlotId;
	}

	/**
	 * Select a plot by ID
	 *
	 * @param index The ID of the plot to select.
	 */
	selectPlot(id: string): void {
		this._onDidSelectPlot.fire(id);
	}

	/**
	 * Selects the next plot in the list, if there is one.
	 */
	selectNextPlot(): void {
		// Get the index of the currently selected plot
		const index = this._plots.findIndex(plot => plot.id === this._selectedPlotId);

		// If we found a plot and it's not the last one in the list, select the
		// next plot.
		if (index >= 0 && index < (this._plots.length - 1)) {
			this._onDidSelectPlot.fire(this._plots[index + 1].id);
		}
	}

	/**
	 * Selects the previous plot in the list, if there is one.
	 */
	selectPreviousPlot(): void {
		// Get the index of the currently selected plot
		const index = this._plots.findIndex(plot => plot.id === this._selectedPlotId);

		// If we found a plot and it's not the first one in the list, select the
		// previous plot.
		if (index > 0) {
			this._onDidSelectPlot.fire(this._plots[index - 1].id);
		}
	}

	/**
	 * Remove a plot by ID
	 *
	 * @param id The ID of the plot to remove
	 */
	removePlot(id: string): void {
		// Find the plot with the given ID and remove it from the list
		this._plots.forEach((plot, index) => {
			if (plot.id === id) {
				plot.dispose();

				// Remove the plot from the list
				this._plots.splice(index, 1);
			}
		});

		// If this plot was selected, select the first plot in the list
		if (this._selectedPlotId === id) {
			if (this._plots.length > 0) {
				// There are still some plots; select the first one
				this._onDidSelectPlot.fire(this._plots[0].id);
			}
			else {
				// There are no plots; clear the selected plot ID
				this._selectedPlotId = undefined;
			}
		}

		// Fire the event notifying subscribers
		this._onDidRemovePlot.fire(id);
	}

	/**
	 * Removes the currently selected plot from the service and fires an event
	 * to update the the UI
	 */
	removeSelectedPlot(): void {
		if (this._selectedPlotId) {
			this.removePlot(this._selectedPlotId);
		} else {
			throw new Error('No plot is selected');
		}
	}

	/**
	 * Removes all the plots from the service and fires an event to
	 * update the the UI
	 */
	removeAllPlots(): void {
		// Dispose each plot in the set
		const count = this._plots.length;
		for (let i = count - 1; i >= 0; i--) {
			const plots = this._plots.splice(i, 1);
			plots[0].dispose();
		}

		// Update the front end with the now-empty array of plots
		this._onDidSelectPlot.fire('');
		this._onDidReplacePlots.fire(this._plots);
	}

	/**
	 * Generates a storage key for a plot.
	 *
	 * @param runtimeId The ID of the runtime that owns the plot.
	 * @param plotId The ID of the plot itself.
	 */
	private generateStorageKey(runtimeId: string, plotId: string): string {
		return `positron.plot.${runtimeId}.${plotId}`;
	}

	/**
	 * Checks to see whether the service has a plot with the given ID.
	 *
	 * @param runtimId The runtime ID that generated the plot.
	 * @param plotId The plot's unique ID.
	 */
	private hasPlot(runtimeId: string, plotId: string): boolean {
		return this._plots.some(plot =>
			plot.metadata.runtime_id === runtimeId &&
			plot.metadata.id === plotId);
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}
