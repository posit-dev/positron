/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotsService, PositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

/**
 * PositronPlotsServices interface. Defines the set of services that are required by the Positron plots.
 */
export interface PositronPlotsServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly positronPlotsService: IPositronPlotsService;
}

/**
 * The Positron plots state.
 */
export interface PositronPlotsState extends PositronPlotsServices {
	readonly positronPlotInstances: PositronPlotClient[];
	selectedInstanceId: string;
}

/**
 * The usePositronPlotsState custom hook.
 * @returns The hook.
 */
export const usePositronPlotsState = (services: PositronPlotsServices): PositronPlotsState => {

	// Hooks.
	const [positronPlotInstances, setPositronPlotInstances] = useState<PositronPlotClient[]>([]);
	const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		// Listen for new plot instances.
		disposableStore.add(services.positronPlotsService.onDidEmitPlot(plotInstance => {
			// Add the plot instance to the list of plot instances
			setPositronPlotInstances(positronPlotInstances => [plotInstance, ...positronPlotInstances]);

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
			setSelectedInstanceId(id);
		}));

		// Listen for plot removal.
		disposableStore.add(services.positronPlotsService.onDidRemovePlot(id => {
			setPositronPlotInstances(positronPlotInstances => positronPlotInstances.filter(p => p.id !== id));
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	return { ...services, positronPlotInstances, selectedInstanceId };
};
