/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IPositronPlotMetadata } from '../../languageRuntime/common/languageRuntimePlotClient.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const POSITRON_PLOTS_VIEW_ID = 'workbench.panel.positronPlots';

/**
 * Context key that tracks where plots are currently displayed.
 * Value is 'MainWindow' or 'AuxiliaryWindow'
 */
export const POSITRON_PLOTS_LOCATION_CONTEXT = new RawContextKey<string>(
	'positronPlotsLocation',
	'MainWindow'
);

export const POSITRON_PLOTS_SERVICE_ID = 'positronPlotsService';

export const IPositronPlotsService = createDecorator<IPositronPlotsService>(POSITRON_PLOTS_SERVICE_ID);

export interface IPositronPlotClient extends IDisposable {
	readonly id: string;
	readonly metadata: IPositronPlotMetadata;
}

export interface IZoomablePlotClient {
	zoomLevel: ZoomLevel;

	onDidChangeZoomLevel: Event<ZoomLevel>;
}

export enum ZoomLevel {
	Fit = 0,
	Fifty = 0.5,
	SeventyFive = 0.75,
	OneHundred = 1,
	TwoHundred = 2,
}

/**
 * Settings necessary to render a plot in the format expected by the plot widget.
 */
export interface PlotRenderSettings {
	size: {
		width: number;
		height: number;
	};
	pixel_ratio: number;
	format: PlotRenderFormat;
}

/**
 * Possible formats for rendering a plot.
 */
export enum PlotRenderFormat {
	Png = 'png',
	Jpeg = 'jpeg',
	Svg = 'svg',
	Pdf = 'pdf',
	Tiff = 'tiff'
}

/**
 * The set of policies governing when we show the plot history (filmstrip
 * sidebar) in the Plots pane
 */
export enum HistoryPolicy {
	AlwaysVisible = 'always',
	Automatic = 'auto',
	NeverVisible = 'never'
}

/**
 * The possible dark filter modes.
 */
export enum DarkFilter {
	/** The dark filter is always on. */
	On = 'on',

	/** The dark filter is always off (i.e. plots are always shown in their given colors */
	Off = 'off',

	/** The dark filter follows the current theme (i.e. it's on in dark themes and off in light themes) */
	Auto = 'auto'
}

export const isZoomablePlotClient = (obj: any): obj is IZoomablePlotClient => {
	return 'zoomLevel' in obj && typeof obj.zoomLevel === 'number' &&
		'onDidChangeZoomLevel' in obj && typeof obj.onDidChangeZoomLevel === 'function';
};

/**
 * The location where the plots pane is currently being displayed.
 */
export enum PlotsDisplayLocation {
	/** Plots are displayed in the main window (auxiliary bar view pane) */
	MainWindow = 'main',
	/** Plots are displayed in an auxiliary window */
	AuxiliaryWindow = 'auxiliary'
}

/**
 * Creates a suggested file name for a plot.
 * @param storageService The storage service to use.
 * @returns A suggested file name for the plot.
 */
export const createSuggestedFileNameForPlot = (storageService: IStorageService) => {
	const key = 'positron.plotNumber';
	const plotNumber = storageService.getNumber(key, StorageScope.APPLICATION, 0) + 1;
	storageService.store(key, plotNumber, StorageScope.APPLICATION, StorageTarget.MACHINE);
	return `plot-${plotNumber}`;
};

/**
 * IPositronPlotsService interface.
 */
export interface IPositronPlotsService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets the individual Positron plot instances.
	 */
	readonly positronPlotInstances: IPositronPlotClient[];

	/**
	 * Gets the currently selected Positron plot instance.
	 */
	readonly selectedPlotId: string | undefined;

	/**
	 * Gets the currently known sizing policies.
	 */
	readonly sizingPolicies: IPositronPlotSizingPolicy[];

	/**
	 * Gets the currently selected sizing policy.
	 */
	readonly selectedSizingPolicy: IPositronPlotSizingPolicy;

	/**
	 * Gets the current history policy.
	 */
	readonly historyPolicy: HistoryPolicy;

	/**
	 * Notifies subscribers when the history policy has changed.
	 */
	readonly onDidChangeHistoryPolicy: Event<HistoryPolicy>;

	/**
	 * Gets the current dark filter mode.
	 */
	readonly darkFilterMode: DarkFilter;

	/**
	 * Notifies subscribers when the dark filter mode has changed.
	 */
	readonly onDidChangeDarkFilterMode: Event<DarkFilter>;

	/**
	 * Notifies subscribers when a new Positron plot instance is created.
	 */
	readonly onDidEmitPlot: Event<IPositronPlotClient>;

	/**
	 * Notifies subscribers when a Positron plot instance is selected. The ID
	 * of the selected plot is the event payload.
	 */
	readonly onDidSelectPlot: Event<string>;

	/**
	 * Notifies subscribers when a Positron plot instance is removed. The ID
	 * of the removed plot is the event payload.
	 */
	readonly onDidRemovePlot: Event<string>;

	/**
	 * Notifies subscribers when the list of Positron plot instances is replaced
	 * with a new list. The new list of plots is the event paylod. This event is
	 * fired when the set of plots needs to be completely refreshed, such as
	 * when several plots are removed or a newly started language runtime has
	 * plots to display.
	 */
	readonly onDidReplacePlots: Event<IPositronPlotClient[]>;

	/**
	 * Notifies subscribers when the settings for rendering a plot have changed.
	 * This typically happens when the plot viewpane has been resized.
	 */
	readonly onDidChangePlotsRenderSettings: Event<PlotRenderSettings>;

	/**
	 * Notifies subscribers when the settings for rendering a plot have changed.
	 * This typically happens when the plot viewpane has been resized.
	 */
	readonly onDidChangeSizingPolicy: Event<IPositronPlotSizingPolicy>;

	/**
	 * Gets the cached plot thumbnail URI for a given plot ID.
	 * @param plotId The plot ID to get the thumbnail URI for.
	 * @returns The thumbnail URI for the plot, or undefined if not found.
	 */
	getCachedPlotThumbnailURI(plotId: string): string | undefined;

	/**
	 * Selects the plot with the specified ID.
	 *
	 * @param id The ID of the plot to select.
	 */
	selectPlot(id: string): void;

	/**
	 * Selects the next plot in the list of plots.
	 */
	selectNextPlot(): void;

	/**
	 * Selects the previous plot in the list of plots.
	 */
	selectPreviousPlot(): void;

	/**
	 * Removes the plot with the specified ID.
	 *
	 * @param id The ID of the plot to remove.
	 */
	removePlot(id: string): void;

	/**
	 * Remove an editor plot.
	 *
	 * @param id The ID of the plot to remove.
	 */
	removeEditorPlot(id: string): void;

	/**
	 * Removes the selected plot.
	 */
	removeSelectedPlot(): void;

	/**
	 * Removes all the plots in the service.
	 */
	removeAllPlots(): void;

	/**
	 * Selects a sizing policy.
	 */
	selectSizingPolicy(id: string): void;

	/**
	 * Sets the sizing policy for the plot.
	 */
	setEditorSizingPolicy(plotId: string, policyId: string): void;

	/**
	 * Sets a custom plot size (and selects the custom sizing policy)
	 */
	setCustomPlotSize(size: IPlotSize): void;

	/**
	 * Clears the custom plot size.
	 */
	clearCustomPlotSize(): void;

	/**
	 * Selects a history policy.
	 */
	selectHistoryPolicy(policy: HistoryPolicy): void;

	/**
	 * Sets a new dark filter mode.
	 */
	setDarkFilterMode(mode: DarkFilter): void;

	/**
	 * Copies the current plot from the Plots View to the clipboard.
	 *
	 * @throws An error if the plot cannot be copied.
	 */
	copyViewPlotToClipboard(): Promise<void>;

	/**
	 * Copies the plot from the editor tab to the clipboard.
	 *
	 * @param plotId The id of the plot to copy.
	 * @throws An error if the plot cannot be copied.
	 */
	copyEditorPlotToClipboard(plotId: string): Promise<void>;

	/**
	 * Opens the selected plot in a new window.
	 */
	openPlotInNewWindow(): void;

	/**
	 * Saves the plot from the Plots View.
	 */
	saveViewPlot(): void;

	/**
	 * Saves the plot from the editor tab.
	 *
	 * @param plotId The id of the plot to save.
	 */
	saveEditorPlot(plotId: string): void;

	/**
	 * Opens the given plot in an editor.
	 *
	 * @param plotId The id of the plot to open in an editor tab.
	 * @param groupType Specify where the editor tab will be opened. Defaults to the preferred
	 * @param metadata The metadata for the plot. Uses the existing plot client if not provided.
	 *   editor group.
	 */
	openEditor(plotId: string, groupType?: number, metadata?: IPositronPlotMetadata): Promise<void>;

	/**
	 * Gets the preferred editor group for opening the plot in an editor tab.
	 */
	getPreferredEditorGroup(): number;

	/**
	 * Gets the plot client that is connected to an editor for the specified id.
	 *
	 * @param id The id of the plot client to get.
	 * @returns The plot client, or undefined if the plot client does not exist.
	 */
	getEditorInstance(id: string): IPositronPlotClient | undefined;

	/**
	 * Removes the plot client and if no other clients are connected to the plot comm, disposes it.
	 *
	 * @param plotClient the plot client to unregister
	 */
	unregisterPlotClient(plotClient: IPositronPlotClient): void;

	/**
	 * Gets the current plot rendering settings.
	 */
	getPlotsRenderSettings(): PlotRenderSettings;

	/**
	 * Sets the current plot rendering settings.
	 *
	 * @param settings The new settings.
	 */
	setPlotsRenderSettings(settings: PlotRenderSettings): void;

	/**
	 * Gets the current display location of the plots pane.
	 */
	readonly displayLocation: PlotsDisplayLocation;

	/**
	 * Notifies subscribers when the display location changes.
	 */
	readonly onDidChangeDisplayLocation: Event<PlotsDisplayLocation>;

	/**
	 * Sets the display location of the plots pane.
	 *
	 * @param location The new display location.
	 */
	setDisplayLocation(location: PlotsDisplayLocation): void;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;
}
