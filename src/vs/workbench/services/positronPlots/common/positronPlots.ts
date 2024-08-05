/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IPlotSize, IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IPositronPlotMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

export const POSITRON_PLOTS_VIEW_ID = 'workbench.panel.positronPlots';

export const POSITRON_PLOTS_SERVICE_ID = 'positronPlotsService';

export const IPositronPlotsService = createDecorator<IPositronPlotsService>(POSITRON_PLOTS_SERVICE_ID);

export interface IPositronPlotClient extends IDisposable {
	readonly id: string;
	readonly metadata: IPositronPlotMetadata;
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
	 * Notifies subscribers when the sizing policy has changed.
	 */
	readonly onDidChangeSizingPolicy: Event<IPositronPlotSizingPolicy>;

	/**
	 * Notifies subscribers when the history policy has changed.
	 */
	readonly onDidChangeHistoryPolicy: Event<HistoryPolicy>;

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
	 * Copies the selected plot to the clipboard.
	 *
	 * @throws An error if the plot cannot be copied.
	 */
	copyPlotToClipboard(): Promise<void>;

	/**
	 * Opens the selected plot in a new window.
	 */
	openPlotInNewWindow(): void;

	/**
	 * Saves the plot.
	 */
	savePlot(): void;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;
}
