/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { Event } from 'vs/base/common/event';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

export const POSITRON_PLOTS_VIEW_ID = 'workbench.panel.positronPlots';

export const POSITRON_PLOTS_SERVICE_ID = 'positronPlotsService';

export const IPositronPlotsService = createDecorator<IPositronPlotsService>(POSITRON_PLOTS_SERVICE_ID);

export type PositronPlotClient = PlotClientInstance | StaticPlotClient;

/**
 * IPositronPlotsService interface.
 */
export interface IPositronPlotsService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets the individual Positron plot instances.
	 */
	readonly positronPlotInstances: PositronPlotClient[];

	/**
	 * Notifies subscribers when a new Positron plot instance is created.
	 */
	readonly onDidEmitPlot: Event<PositronPlotClient>;

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
	readonly onDidReplacePlots: Event<PositronPlotClient[]>;

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
	 * Placeholder for service initialization.
	 */
	initialize(): void;
}
