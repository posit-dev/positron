/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { DynamicPlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/dynamicPlotInstance';
import { DynamicPlotThumbnail } from 'vs/workbench/contrib/positronPlots/browser/components/dynamicPlotThumbnail';
import { StaticPlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/staticPlotInstance';
import { StaticPlotThumbnail } from 'vs/workbench/contrib/positronPlots/browser/components/staticPlotThumbnail';
import { usePositronPlotsContext } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { PositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

/**
 * PlotContainerProps interface.
 */
interface PlotContainerProps {
	width: number;
	height: number;
}

/**
 * The number of pixels (height or width) to use for the history portion of the
 * plots container.
 */
export const HistoryPx = 100;

/**
 * PlotContainer component; holds the plot instances.
 *
 * @param props A PlotContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotsContainer = (props: PlotContainerProps) => {

	const positronPlotsContext = usePositronPlotsContext();

	useEffect(() => {
		// Empty for now.
	});

	/**
	 * Renders either a DynamicPlotInstance (resizable plot) or a
	 * StaticPlotInstance (static plot image), depending on the type of plot
	 * instance.
	 *
	 * @param plotInstance The plot instance to render
	 * @returns The rendered component.
	 */
	const render = (plotInstance: PositronPlotClient) => {
		if (plotInstance instanceof PlotClientInstance) {
			return <DynamicPlotInstance
				key={plotInstance.id}
				width={props.width}
				height={props.height - HistoryPx}
				plotClient={plotInstance} />;
		} else if (plotInstance instanceof StaticPlotClient) {
			return <StaticPlotInstance
				key={plotInstance.id}
				plotClient={plotInstance} />;
		}
		return null;
	};

	/**
	 * Renders a thumbnail of either a DynamicPlotInstance (resizable plot) or a
	 * StaticPlotInstance (static plot image), depending on the type of plot
	 * instance.
	 *
	 * @param plotInstance The plot instance to render
	 * @param selected Whether the thumbnail is selected
	 * @returns
	 */
	const renderThumbnail = (plotInstance: PositronPlotClient, selected: boolean) => {
		if (plotInstance instanceof PlotClientInstance) {
			return <DynamicPlotThumbnail
				key={plotInstance.id}
				selected={selected}
				plotService={positronPlotsContext}
				plotClient={plotInstance} />;
		} else if (plotInstance instanceof StaticPlotClient) {
			return <StaticPlotThumbnail
				key={plotInstance.id}
				selected={selected}
				plotService={positronPlotsContext}
				plotClient={plotInstance} />;
		}
		return null;
	};

	// If there are no plot instances, show a placeholder; otherwise, show the
	// most recently generated plot.
	//
	// In the future we will probably want to have a filmstrip history of plot
	// instances here for easy navigation.
	return (
		<div className='plots-container'>
			<div className='selected-plot'>
				{positronPlotsContext.positronPlotInstances.length === 0 &&
					<span>Plot container: {props.height} x {props.width}</span>}
				{positronPlotsContext.positronPlotInstances.map((plotInstance, index) => (
					plotInstance.id === positronPlotsContext.selectedInstanceId &&
					render(plotInstance)
				))}
			</div>
			<div className='plot-history'>
				{positronPlotsContext.positronPlotInstances.map((plotInstance) => (
					renderThumbnail(plotInstance,
						plotInstance.id === positronPlotsContext.selectedInstanceId)
				))}
			</div>
		</div>
	);
};
