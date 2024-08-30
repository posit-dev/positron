/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotClient, IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';

/**
 * PositronPlotsServices interface. Defines the set of services that are required by the Positron plots.
 */
export interface PositronPlotsServices extends PositronActionBarServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly positronPlotsService: IPositronPlotsService;
	readonly notificationService: INotificationService;
}

/**
 * The Positron plots state.
 */
export interface PositronPlotsState extends PositronPlotsServices {
	readonly positronPlotInstances: IPositronPlotClient[];
	selectedInstanceId: string;
	selectedInstanceIndex: number;
}

/**
 * The usePositronPlotsState custom hook.
 * @returns The hook.
 */
export const usePositronPlotsState = (services: PositronPlotsServices): PositronPlotsState => {

	// Hooks.

	// Initial set of plot instances.
	const [positronPlotInstances, setPositronPlotInstances] = useState<IPositronPlotClient[]>(
		services.positronPlotsService.positronPlotInstances);

	// Initial selected plot instance.
	const initialSelectedId = services.positronPlotsService.selectedPlotId;
	const [selectedInstanceId, setSelectedInstanceId] = useState<string>(initialSelectedId ?? '');

	// Index of the selected plot instance.
	const initialSelectedIndex = services.positronPlotsService.positronPlotInstances.findIndex
		(p => p.id === initialSelectedId);
	const [selectedInstanceIndex, setSelectedInstanceIndex] = useState<number>(initialSelectedIndex);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		// Listen for new plot instances.
		disposableStore.add(services.positronPlotsService.onDidEmitPlot(plotInstance => {
			// Add the plot instance to the list of plot instances
			setPositronPlotInstances(positronPlotInstances => {
				// This can be called multiple times for the same plot instance, so make sure
				// we don't add it twice.
				if (positronPlotInstances.some(p => p.id === plotInstance.id)) {
					return positronPlotInstances;
				}
				return [...positronPlotInstances, plotInstance];
			});

			// When the plot closes, remove it from the list of plot instances.
			// (If the plot is not a plot client instance, then it doesn't have
			// a backend and therefore doesn't need to be removed from the list
			// of active plot instances.)
			if (plotInstance instanceof PlotClientInstance) {
				plotInstance.onDidClose(() => {
					setPositronPlotInstances(positronPlotInstances => positronPlotInstances.filter(p => p !== plotInstance));
				});
			}
		}));

		// Listen for plot selection changes.
		disposableStore.add(services.positronPlotsService.onDidSelectPlot(id => {
			// Set the selected plot instance.
			setSelectedInstanceId(id);

			// Find the index of the selected plot instance.
			const index = services.positronPlotsService.positronPlotInstances.findIndex(
				p => p.id === id);
			setSelectedInstanceIndex(index);
		}));

		// Listen for plot removal.
		disposableStore.add(services.positronPlotsService.onDidRemovePlot(id => {
			setPositronPlotInstances(positronPlotInstances => positronPlotInstances.filter(p => p.id !== id));
		}));

		// Listen for replacing all plots.
		disposableStore.add(services.positronPlotsService.onDidReplacePlots((plots) => {
			setPositronPlotInstances(plots);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	return { ...services, positronPlotInstances, selectedInstanceId, selectedInstanceIndex };
};
