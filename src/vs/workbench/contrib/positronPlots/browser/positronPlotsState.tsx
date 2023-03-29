/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';

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
	readonly positronPlotInstances: PlotClientInstance[];
}

/**
 * The usePositronPlotsState custom hook.
 * @returns The hook.
 */
export const usePositronPlotsState = (services: PositronPlotsServices): PositronPlotsState => {

	// Hooks.
	const [positronPlotInstances, setPositronPlotInstances] =
		useState<PlotClientInstance[]>(
			services.positronPlotsService.positronPlotInstances
		);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		// Listen for new plot instances.
		disposableStore.add(services.positronPlotsService.onDidEmitPlot(plotInstance => {
			setPositronPlotInstances(positronPlotInstances => [...positronPlotInstances, plotInstance]);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	return { ...services, positronPlotInstances };
};
