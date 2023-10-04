/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPlotMetadata, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntime, ILanguageRuntimeMessageOutput, ILanguageRuntimeService, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { HistoryPolicy, IPositronPlotsService, POSITRON_PLOTS_VIEW_ID, PositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { Emitter, Event } from 'vs/base/common/event';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';
import { IStorageService, StorageTarget, StorageScope } from 'vs/platform/storage/common/storage';
import { IViewsService } from 'vs/workbench/common/views';
import { IPlotSize, IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import { PlotSizingPolicyAuto } from 'vs/workbench/services/positronPlots/common/sizingPolicyAuto';
import { PlotSizingPolicySquare } from 'vs/workbench/services/positronPlots/common/sizingPolicySquare';
import { PlotSizingPolicyFill } from 'vs/workbench/services/positronPlots/common/sizingPolicyFill';
import { PlotSizingPolicyLandscape } from 'vs/workbench/services/positronPlots/common/sizingPolicyLandscape';
import { PlotSizingPolicyPortrait } from 'vs/workbench/services/positronPlots/common/sizingPolicyPortrait';
import { PlotSizingPolicyCustom } from 'vs/workbench/services/positronPlots/common/sizingPolicyCustom';

/** The maximum number of recent executions to store. */
const MaxRecentExecutions = 10;

/** The key used to store the preferred history policy */
const HistoryPolicyStorageKey = 'positron.plots.historyPolicy';

/** The key used to store the preferred plot sizing policy */
const SizingPolicyStorageKey = 'positron.plots.sizingPolicy';

/** The key used to store the custom plot size */
const CustomPlotSizeStorageKey = 'positron.plots.customPlotSize';

/**
 * PositronPlotsService class.
 */
export class PositronPlotsService extends Disposable implements IPositronPlotsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** The list of Positron plots. */
	private readonly _plots: PositronPlotClient[] = [];

	/** The list of sizing policies. */
	private readonly _sizingPolicies: IPositronPlotSizingPolicy[] = [];

	/** The emitter for the onDidChangeSizingPolicy event */
	private readonly _onDidChangeSizingPolicy = new Emitter<IPositronPlotSizingPolicy>();

	/** The emitter for the onDidChangeHistoryPolicy event */
	private readonly _onDidChangeHistoryPolicy = new Emitter<HistoryPolicy>();

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

	/** The currently selected sizing policy. */
	private _selectedSizingPolicy: IPositronPlotSizingPolicy;

	/** A custom sizing policy, if we have one. */
	private _customSizingPolicy?: PlotSizingPolicyCustom;

	/** The currently selected history policy. */
	private _selectedHistoryPolicy: HistoryPolicy = HistoryPolicy.Automatic;

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

		// When the storage service is about to save state, store the current history policy
		// and storage policy in the workspace storage.
		this._storageService.onWillSaveState(() => {

			this._storageService.store(
				HistoryPolicyStorageKey,
				this._selectedHistoryPolicy,
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE);

			this._storageService.store(
				SizingPolicyStorageKey,
				this._selectedSizingPolicy.id,
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE);

			if (this._customSizingPolicy) {
				// If we have a custom sizing policy, store it in the workspace storage
				this._storageService.store(
					CustomPlotSizeStorageKey,
					JSON.stringify(this._customSizingPolicy.size),
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);
			} else {
				// If we don't, clear the custom plot size from storage
				this._storageService.store(
					CustomPlotSizeStorageKey,
					undefined,
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);
			}
		});

		// Create the default sizing policy
		this._selectedSizingPolicy = new PlotSizingPolicyAuto();
		this._sizingPolicies.push(this._selectedSizingPolicy);

		// Add some other nifty sizing policies
		this._sizingPolicies.push(new PlotSizingPolicySquare());
		this._sizingPolicies.push(new PlotSizingPolicyLandscape());
		this._sizingPolicies.push(new PlotSizingPolicyPortrait());
		this._sizingPolicies.push(new PlotSizingPolicyFill());

		// See if there's a custom size policy in storage, and retrieve it if so
		const customSizingPolicy = this._storageService.get(
			CustomPlotSizeStorageKey,
			StorageScope.WORKSPACE);
		if (customSizingPolicy) {
			try {
				// Parse the custom size policy and create a new custom sizing policy
				const size = JSON.parse(customSizingPolicy) as IPlotSize;
				this._customSizingPolicy = new PlotSizingPolicyCustom(size);
				this._sizingPolicies.push(this._customSizingPolicy);
			} catch (error) {
				console.warn(`Error parsing custom plot size: ${error}`);
			}
		}

		// See if there's a preferred sizing policy in storage, and select it if so
		const preferredSizingPolicyId = this._storageService.get(
			SizingPolicyStorageKey,
			StorageScope.WORKSPACE);
		if (preferredSizingPolicyId) {
			const policy = this._sizingPolicies.find(
				policy => policy.id === preferredSizingPolicyId);
			if (policy) {
				this._selectedSizingPolicy = policy;
			}
		}

		// See if there's a preferred history policy in storage, and select it if so
		const preferredHistoryPolicy = this._storageService.get(
			HistoryPolicyStorageKey,
			StorageScope.WORKSPACE);
		if (preferredHistoryPolicy && preferredHistoryPolicy) {
			this._selectedHistoryPolicy = preferredHistoryPolicy as HistoryPolicy;
		}
	}

	/**
	 * Gets the currently known sizing policies.
	 */
	get sizingPolicies() {
		return this._sizingPolicies;
	}

	/**
	 * Gets the currently selected sizing policy.
	 */
	get selectedSizingPolicy() {
		return this._selectedSizingPolicy;
	}

	/**
	 * Gets the current history policy.
	 */
	get historyPolicy() {
		return this._selectedHistoryPolicy;
	}

	/**
	 * Selects a new sizing policy and fires an event indicating that the policy
	 * has changed.
	 *
	 * @param id The sizing policy ID to select.
	 */
	selectSizingPolicy(id: string): void {
		// Is this the currently selected policy?
		if (this.selectedSizingPolicy.id === id) {
			return;
		}

		// Find the policy with the given ID
		const policy = this._sizingPolicies.find(policy => policy.id === id);
		if (!policy) {
			throw new Error(`Invalid sizing policy ID: ${id}`);
		}
		this._selectedSizingPolicy = policy;
		this._onDidChangeSizingPolicy.fire(policy);
	}

	/**
	 * Sets a custom plot size and applies it as a custom sizing policy.
	 *
	 * @param size The new custom plot size.
	 */
	setCustomPlotSize(size: IPlotSize): void {
		// See if we already have a custom sizing policy; if we do, remove it so
		// we can add a new one (currently we only support one custom sizing
		// policy at a time)
		if (this._customSizingPolicy) {
			this._sizingPolicies.splice(this._sizingPolicies.indexOf(this._customSizingPolicy), 1);
		}

		// Create and apply the new custom sizing policy
		const policy = new PlotSizingPolicyCustom(size);
		this._sizingPolicies.push(policy);
		this._selectedSizingPolicy = policy;
		this._customSizingPolicy = policy;
		this._onDidChangeSizingPolicy.fire(policy);
	}

	/**
	 * Clears the custom plot size, if one is set. If the custom plot size policy is in used,
	 * switch to the automatic sizing policy.
	 */
	clearCustomPlotSize(): void {
		// Check to see whether the custom sizing policy is currently in use
		const currentPolicy = this._customSizingPolicy === this._selectedSizingPolicy;

		if (this._customSizingPolicy) {
			// If there's a custom sizing policy, remove it from the list of
			// sizing policies.
			this._sizingPolicies.splice(this._sizingPolicies.indexOf(this._customSizingPolicy), 1);
			this._customSizingPolicy = undefined;

			// If the custom sizing policy was in use, switch to the automatic
			// sizing policy.
			if (currentPolicy) {
				this._selectedSizingPolicy = new PlotSizingPolicyAuto();
				this._onDidChangeSizingPolicy.fire(this._selectedSizingPolicy);
			}
		}
	}

	/**
	 * Selects a new history policy and fires an event indicating that the policy
	 * has changed.
	 */
	selectHistoryPolicy(policy: HistoryPolicy): void {
		// Is this the currently selected policy?
		if (this.historyPolicy === policy) {
			return;
		}

		this._selectedHistoryPolicy = policy;
		this._onDidChangeHistoryPolicy.fire(policy);
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

				// Raise the Plots pane so the plot is visible.
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
				// Create a new static plot client instance and register it with the service.
				this.registerStaticPlot(runtime.metadata.runtimeId, message, code);

				// Raise the Plots pane so the plot is visible.
				this._viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);
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

		// Raise the plot if it's updated by the runtime
		plotClient.onDidRenderUpdate((_plot) => {
			// Raise the Plots pane so the user can see the updated plot
			this._viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);

			// Select the plot to bring it into view within the history; it's
			// possible that it is not the most recently created plot
			this._onDidSelectPlot.fire(plotClient.id);
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
	onDidChangeSizingPolicy: Event<IPositronPlotSizingPolicy> = this._onDidChangeSizingPolicy.event;
	onDidChangeHistoryPolicy: Event<HistoryPolicy> = this._onDidChangeHistoryPolicy.event;

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
