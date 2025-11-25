/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../../base/common/lifecycle.js';
import { IPositronPlotsService, IPositronPlotClient, HistoryPolicy, DarkFilter, PlotRenderSettings, PlotsDisplayLocation } from '../../common/positronPlots.js';
import { IPositronPlotSizingPolicy } from '../../common/sizingPolicy.js';
import { IPositronPlotMetadata } from '../../../languageRuntime/common/languageRuntimePlotClient.js';

/**
 * TestPositronPlotsService class.
 *
 * This is an implementation of the IPositronPlotsService for use in tests.
 */
export class TestPositronPlotsService extends Disposable implements IPositronPlotsService {
	//#region Private Properties

	/**
	 * Gets a map of the Positron plot instances by ID.
	 */
	private readonly _plotClientsByPlotId =
		this._register(new DisposableMap<string, IPositronPlotClient>());

	/**
	 * Gets a map of the Positron editor plot instances by ID.
	 */
	private readonly _editorPlots = new Map<string, IPositronPlotClient>();

	/**
	 * Gets or sets the ID of the currently selected plot.
	 */
	private _selectedPlotId?: string;

	/**
	 * Gets or sets the currently selected sizing policy.
	 */
	private _selectedSizingPolicy!: IPositronPlotSizingPolicy;

	/**
	 * The list of sizing policies.
	 */
	private readonly _sizingPolicies: IPositronPlotSizingPolicy[] = [];

	/**
	 * Gets or sets the currently selected history policy.
	 */
	private _selectedHistoryPolicy: HistoryPolicy = HistoryPolicy.Automatic;

	/**
	 * Gets or sets the currently selected dark filter mode.
	 */
	private _selectedDarkFilterMode: DarkFilter = DarkFilter.Auto;

	/**
	 * Gets or sets the current display location.
	 */
	private _displayLocation: PlotsDisplayLocation = PlotsDisplayLocation.MainWindow;

	/**
	 * The onDidEmitPlot event emitter.
	 */
	private readonly _onDidEmitPlotEmitter =
		this._register(new Emitter<IPositronPlotClient>());

	/**
	 * The onDidSelectPlot event emitter.
	 */
	private readonly _onDidSelectPlotEmitter =
		this._register(new Emitter<string>());

	/**
	 * The onDidRemovePlot event emitter.
	 */
	private readonly _onDidRemovePlotEmitter =
		this._register(new Emitter<string>());

	/**
	 * The onDidReplacePlots event emitter.
	 */
	private readonly _onDidReplacePlotsEmitter =
		this._register(new Emitter<IPositronPlotClient[]>());

	/**
	 * The onDidChangeHistoryPolicy event emitter.
	 */
	private readonly _onDidChangeHistoryPolicyEmitter =
		this._register(new Emitter<HistoryPolicy>());

	/**
	 * The onDidChangeDarkFilterMode event emitter.
	 */
	private readonly _onDidChangeDarkFilterModeEmitter =
		this._register(new Emitter<DarkFilter>());

	/**
	 * The onDidChangePlotsRenderSettings event emitter.
	 */
	private readonly _onDidChangePlotsRenderSettingsEmitter =
		this._register(new Emitter<PlotRenderSettings>());

	/** The emitter for the _sizingPolicyEmitter event */
	private readonly _onDidChangeSizingPolicyEmitter =
		this._register(new Emitter<IPositronPlotSizingPolicy>());

	/**
	 * The onDidChangeDisplayLocation event emitter.
	 */
	private readonly _onDidChangeDisplayLocationEmitter =
		this._register(new Emitter<PlotsDisplayLocation>());

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 */
	constructor() {
		super();
	}

	getPlotsRenderSettings(): PlotRenderSettings {
		throw new Error('Method not implemented.');
	}
	setPlotsRenderSettings(settings: PlotRenderSettings): void {
		throw new Error('Method not implemented.');
	}

	//#endregion Constructor

	//#region IPositronPlotsService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Gets the individual Positron plot instances.
	 */
	get positronPlotInstances(): IPositronPlotClient[] {
		return Array.from(this._plotClientsByPlotId.values());
	}

	/**
	 * Gets the ID of the currently selected plot.
	 */
	get selectedPlotId(): string | undefined {
		return this._selectedPlotId;
	}

	/**
	 * Gets the currently known sizing policies.
	 */
	get sizingPolicies(): IPositronPlotSizingPolicy[] {
		return this._sizingPolicies;
	}

	/**
	 * Gets the currently selected sizing policy.
	 */
	get selectedSizingPolicy(): IPositronPlotSizingPolicy {
		return this._selectedSizingPolicy;
	}

	/**
	 * Gets the current history policy.
	 */
	get historyPolicy(): HistoryPolicy {
		return this._selectedHistoryPolicy;
	}

	/**
	 * Gets the current dark filter mode.
	 */
	get darkFilterMode(): DarkFilter {
		return this._selectedDarkFilterMode;
	}

	/**
	 * Gets the current display location.
	 */
	get displayLocation(): PlotsDisplayLocation {
		return this._displayLocation;
	}

	/**
	 * The onDidEmitPlot event.
	 */
	readonly onDidEmitPlot = this._onDidEmitPlotEmitter.event;

	/**
	 * The onDidSelectPlot event.
	 */
	readonly onDidSelectPlot = this._onDidSelectPlotEmitter.event;

	/**
	 * The onDidRemovePlot event.
	 */
	readonly onDidRemovePlot = this._onDidRemovePlotEmitter.event;

	/**
	 * The onDidReplacePlots event.
	 */
	readonly onDidReplacePlots = this._onDidReplacePlotsEmitter.event;

	/**
	 * The onDidChangeHistoryPolicy event.
	 */
	readonly onDidChangeHistoryPolicy = this._onDidChangeHistoryPolicyEmitter.event;

	/**
	 * The onDidChangeDarkFilterMode event.
	 */
	readonly onDidChangeDarkFilterMode = this._onDidChangeDarkFilterModeEmitter.event;

	/**
	 * The onDidChangePlotsRenderSettings event.
	 */
	readonly onDidChangePlotsRenderSettings = this._onDidChangePlotsRenderSettingsEmitter.event;

	/**
	 * The onDidChangeSizingPolicy event.
	 */
	readonly onDidChangeSizingPolicy = this._onDidChangeSizingPolicyEmitter.event;

	/**
	 * The onDidChangeDisplayLocation event.
	 */
	readonly onDidChangeDisplayLocation = this._onDidChangeDisplayLocationEmitter.event;

	/**
	 * Gets the cached plot thumbnail URI for a given plot ID.
	 * @param plotId The plot ID to get the thumbnail URI for.
	 * @returns The thumbnail URI for the plot, or undefined if not found.
	 */
	getCachedPlotThumbnailURI(plotId: string) {
		// Noop in test implementation. In a real implementation, this would return the URI of the cached thumbnail.
		return undefined;
	}

	/**
	 * Selects the plot with the specified ID.
	 *
	 * @param id The ID of the plot to select.
	 */
	selectPlot(id: string): void {
		this._selectedPlotId = id;
		this._onDidSelectPlotEmitter.fire(id);
	}

	/**
	 * Selects the next plot in the list of plots.
	 */
	selectNextPlot(): void {
		const plots = this.positronPlotInstances;
		if (plots.length === 0) {
			return;
		}

		const currentIndex = this._selectedPlotId
			? plots.findIndex(plot => plot.id === this._selectedPlotId)
			: -1;

		const nextIndex = (currentIndex + 1) % plots.length;
		this.selectPlot(plots[nextIndex].id);
	}

	/**
	 * Selects the previous plot in the list of plots.
	 */
	selectPreviousPlot(): void {
		const plots = this.positronPlotInstances;
		if (plots.length === 0) {
			return;
		}

		const currentIndex = this._selectedPlotId
			? plots.findIndex(plot => plot.id === this._selectedPlotId)
			: -1;

		const prevIndex = currentIndex < 0
			? plots.length - 1
			: (currentIndex - 1 + plots.length) % plots.length;
		this.selectPlot(plots[prevIndex].id);
	}

	/**
	 * Removes the plot with the specified ID.
	 *
	 * @param id The ID of the plot to remove.
	 */
	removePlot(id: string): void {
		const plot = this._plotClientsByPlotId.get(id);
		if (plot) {
			this._plotClientsByPlotId.deleteAndDispose(id);

			// If this plot was selected, select another one
			if (this._selectedPlotId === id) {
				const plots = this.positronPlotInstances;
				if (plots.length > 0) {
					this._selectedPlotId = plots[0].id;
				} else {
					this._selectedPlotId = undefined;
				}
			}

			this._onDidRemovePlotEmitter.fire(id);
		}
	}

	/**
	 * Remove an editor plot.
	 *
	 * @param id The ID of the plot to remove.
	 */
	removeEditorPlot(id: string): void {
		const plot = this._editorPlots.get(id);
		if (plot) {
			this.unregisterPlotClient(plot);
			this._editorPlots.delete(id);
		}
	}

	/**
	 * Removes the selected plot.
	 */
	removeSelectedPlot(): void {
		if (this._selectedPlotId) {
			this.removePlot(this._selectedPlotId);
		}
	}

	/**
	 * Removes all the plots in the service.
	 */
	removeAllPlots(): void {
		const plotIds = Array.from(this._plotClientsByPlotId.keys());
		for (const id of plotIds) {
			this.removePlot(id);
		}
		this._onDidReplacePlotsEmitter.fire([]);
	}

	/**
	 * Selects a sizing policy.
	 */
	selectSizingPolicy(id: string): void {
		const policy = this._sizingPolicies.find(policy => policy.id === id);
		if (policy) {
			this._selectedSizingPolicy = policy;
		}
	}

	/**
	 * Sets the sizing policy for the plot.
	 */
	setEditorSizingPolicy(plotId: string, policyId: string): void {
		// Test implementation - no-op
	}

	/**
	 * Sets a custom plot size (and selects the custom sizing policy)
	 */
	setCustomPlotSize(size: any): void {
		// Test implementation - no-op
	}

	/**
	 * Clears the custom plot size.
	 */
	clearCustomPlotSize(): void {
		// Test implementation - no-op
	}

	/**
	 * Selects a history policy.
	 */
	selectHistoryPolicy(policy: HistoryPolicy): void {
		this._selectedHistoryPolicy = policy;
		this._onDidChangeHistoryPolicyEmitter.fire(policy);
	}

	/**
	 * Sets the dark filter mode.
	 */
	setDarkFilterMode(mode: DarkFilter): void {
		this._selectedDarkFilterMode = mode;
		this._onDidChangeDarkFilterModeEmitter.fire(mode);
	}

	/**
	 * Sets the display location.
	 */
	setDisplayLocation(location: PlotsDisplayLocation): void {
		if (this._displayLocation !== location) {
			this._displayLocation = location;
			this._onDidChangeDisplayLocationEmitter.fire(location);
		}
	}

	/**
	 * Copy a plot from the view to the clipboard.
	 */
	copyViewPlotToClipboard(): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Copy a plot from the editor to the clipboard.
	 *
	 * @param plotId The id of the plot to copy.
	 * @throws An error if the plot cannot be copied.
	 */
	copyEditorPlotToClipboard(plotId: string): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Selects a dark filter mode.
	 * @deprecated Use setDarkFilterMode instead.
	 */
	selectDarkFilterMode(mode: DarkFilter): void {
		this.setDarkFilterMode(mode);
	}

	/**
	 * Copy a plot from the view to the clipboard.
	 * @deprecated Use copyViewPlotToClipboard instead.
	 */
	copyPlotToClipboard(): Promise<void> {
		return this.copyViewPlotToClipboard();
	}

	/**
	 * Opens the selected plot in a new window.
	 */
	openPlotInNewWindow(): void {
		// Test implementation - no-op
	}

	/**
	 * Saves the plot from the Plots View.
	 */
	saveViewPlot(): void {
		// Test implementation - no-op
	}

	/**
	 * Saves the plot from the editor tab.
	 *
	 * @param plotId The id of the plot to save.
	 */
	saveEditorPlot(plotId: string): void {
		// Test implementation - no-op
	}

	/**
	 * Opens the given plot in an editor.
	 *
	 * @param plotId The id of the plot to open in an editor tab.
	 * @param groupType Specify where the editor tab will be opened. Defaults to the preferred editor group.
	 * @param metadata The metadata for the plot. Uses the existing plot client if not provided.
	 */
	async openEditor(plotId: string, groupType?: number, metadata?: IPositronPlotMetadata): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Gets the preferred editor group for opening the plot in an editor tab.
	 */
	getPreferredEditorGroup(): number {
		return 0; // Default to active group for test implementation
	}

	/**
	 * Gets the plot client that is connected to an editor for the specified id.
	 *
	 * @param id The id of the plot client to get.
	 * @returns The plot client, or undefined if the plot client does not exist.
	 */
	getEditorInstance(id: string): IPositronPlotClient | undefined {
		return this._editorPlots.get(id);
	}

	/**
	 * Removes the plot client and if no other clients are connected to the plot comm, disposes it.
	 *
	 * @param plotClient the plot client to unregister
	 */
	unregisterPlotClient(plotClient: IPositronPlotClient): void {
		// Dispose the client
		plotClient.dispose();
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void {
		// No-op in test implementation
	}

	//#endregion IPositronPlotsService Implementation

	//#region Test Helper Methods

	/**
	 * Adds a plot client to the service.
	 * @param plotClient The plot client to add.
	 * @param selectAfterAdd Whether to select the plot after adding it.
	 */
	addPlotClient(plotClient: IPositronPlotClient, selectAfterAdd: boolean = false): void {
		this._plotClientsByPlotId.set(plotClient.id, plotClient);
		this._onDidEmitPlotEmitter.fire(plotClient);

		if (selectAfterAdd) {
			this.selectPlot(plotClient.id);
		}
	}

	/**
	 * Adds a plot client as an editor plot.
	 * @param plotClient The plot client to add as an editor plot.
	 */
	addEditorPlot(plotClient: IPositronPlotClient): void {
		this._editorPlots.set(plotClient.id, plotClient);
	}

	/**
	 * Fires a replacement of all plots event with the current plots.
	 */
	fireReplacePlotsEvent(): void {
		this._onDidReplacePlotsEmitter.fire(this.positronPlotInstances);
	}

	/**
	 * Adds a sizing policy to the service.
	 * @param policy The sizing policy to add.
	 */
	addSizingPolicy(policy: IPositronPlotSizingPolicy): void {
		this._sizingPolicies.push(policy);
		if (this._sizingPolicies.length === 1) {
			// If this is the first policy, make it the selected one
			this._selectedSizingPolicy = policy;
		}
	}

	//#endregion Test Helper Methods
}
