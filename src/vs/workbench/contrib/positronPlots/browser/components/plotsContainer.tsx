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
	showHistory: boolean;
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
	const plotHistoryRef = React.createRef<HTMLDivElement>();

	// We generally prefer showing the history on the bottom (making the plot
	// wider), but if the plot container is too wide, we show it on the right
	// instead.
	const historyBottom = props.height / props.width > 0.75;

	const historyPx = props.showHistory ? HistoryPx : 0;
	const historyEdge = historyBottom ? 'history-bottom' : 'history-right';
	const plotHeight = historyBottom ? props.height - historyPx : props.height;
	const plotWidth = historyBottom ? props.width : props.width - historyPx;

	useEffect(() => {
		// Ensure the selected plot is visible. We do this so that the history
		// filmstrip automatically scrolls to new plots as they are emitted, or
		// when the user selects a plot.
		const plotHistory = plotHistoryRef.current;
		if (plotHistory) {
			// Find the selected plot in the history
			const selectedPlot = plotHistory.querySelector('.selected');
			if (selectedPlot) {
				// If a plot is selected, scroll it into view.
				selectedPlot.scrollIntoView();
			} else {
				// If no plot is selected, scroll the history to the end, which
				// will show the most recently generated plot.
				plotHistory.scrollLeft = plotHistory.scrollWidth;
				plotHistory.scrollTop = plotHistory.scrollHeight;
			}
		}
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
				width={plotWidth}
				height={plotHeight}
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

	// Render the plot history gallery.
	const renderHistory = () => {
		return <div className='plot-history-scroller' ref={plotHistoryRef}>
			<div className='plot-history'>
				{positronPlotsContext.positronPlotInstances.map((plotInstance) => (
					renderThumbnail(plotInstance,
						plotInstance.id === positronPlotsContext.selectedInstanceId)
				))}
			</div>
		</div>;
	};

	// If there are no plot instances, show a placeholder; otherwise, show the
	// most recently generated plot.
	return (
		<div className={'plots-container ' + historyEdge}>
			<div className='selected-plot'>
				{positronPlotsContext.positronPlotInstances.length === 0 &&
					<div className='plot-placeholder'></div>}
				{positronPlotsContext.positronPlotInstances.map((plotInstance, index) => (
					plotInstance.id === positronPlotsContext.selectedInstanceId &&
					render(plotInstance)
				))}
			</div>
			{props.showHistory && renderHistory()}
		</div>
	);
};
