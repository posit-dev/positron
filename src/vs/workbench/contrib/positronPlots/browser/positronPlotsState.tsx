/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IPositronPlotClient } from '../../../services/positronPlots/common/positronPlots.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * The Positron plots state.
 */
export interface PositronPlotsState {
	readonly positronPlotInstances: IPositronPlotClient[];
	selectedInstanceId: string;
	selectedInstanceIndex: number;
	/** Counter that increments when any plot's metadata changes, used to trigger re-renders. */
	metadataVersion: number;
}

/**
 * The usePositronPlotsState custom hook.
 * @returns The hook.
 */
export const usePositronPlotsState = (): PositronPlotsState => {
	// Hooks.
	const services = usePositronReactServicesContext();

	// Initial set of plot instances.
	const [positronPlotInstances, setPositronPlotInstances] = useState<IPositronPlotClient[]>(
		() => [...services.positronPlotsService.positronPlotInstances]);

	// Initial selected plot instance.
	const initialSelectedId = services.positronPlotsService.selectedPlotId;
	const [selectedInstanceId, setSelectedInstanceId] = useState<string>(initialSelectedId ?? '');

	// Resolve the selection against the current plot list after additions and removals.
	const selectedInstanceIndex = positronPlotInstances.findIndex(p => p.id === selectedInstanceId);

	// Counter to trigger re-renders when metadata changes.
	const [metadataVersion, setMetadataVersion] = useState<number>(0);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		// The service changes its plot list in place, so each handler copies it
		// to give React a new array. Copying (rather than updating a list of our
		// own) keeps the pane in the order Previous/Next use.
		const copyPlots = () => setPositronPlotInstances([...services.positronPlotsService.positronPlotInstances]);

		// Listen for new plot instances.
		disposableStore.add(services.positronPlotsService.onDidEmitPlot(copyPlots));

		// Listen for plot selection changes.
		disposableStore.add(services.positronPlotsService.onDidSelectPlot(id => {
			// Set the selected plot instance.
			setSelectedInstanceId(id);
		}));

		// Listen for plot removal, including a plot whose comm closed.
		disposableStore.add(services.positronPlotsService.onDidRemovePlot(copyPlots));

		// Listen for replacing all plots.
		disposableStore.add(services.positronPlotsService.onDidReplacePlots(copyPlots));

		// Listen for metadata updates.
		disposableStore.add(services.positronPlotsService.onDidUpdatePlotMetadata(() => {
			setMetadataVersion(v => v + 1);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [services.positronPlotsService]);

	return { positronPlotInstances, selectedInstanceId, selectedInstanceIndex, metadataVersion };
};
