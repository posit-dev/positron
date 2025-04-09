/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './plotsContainer.css';

// React.
import React, { useEffect } from 'react';

// Other dependencies.
import { DynamicPlotInstance } from './dynamicPlotInstance.js';
import { DynamicPlotThumbnail } from './dynamicPlotThumbnail.js';
import { PlotGalleryThumbnail } from './plotGalleryThumbnail.js';
import { StaticPlotInstance } from './staticPlotInstance.js';
import { StaticPlotThumbnail } from './staticPlotThumbnail.js';
import { WebviewPlotInstance } from './webviewPlotInstance.js';
import { WebviewPlotThumbnail } from './webviewPlotThumbnail.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';
import { WebviewPlotClient } from '../webviewPlotClient.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { DarkFilter, IPositronPlotClient } from '../../../../services/positronPlots/common/positronPlots.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';

/**
 * PlotContainerProps interface.
 */
interface PlotContainerProps {
	width: number;
	height: number;
	x: number;
	y: number;
	visible: boolean;
	showHistory: boolean;
	darkFilterMode: DarkFilter;
	zoom: number;
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
				selectedPlot.scrollIntoView({ behavior: 'smooth' });
			} else {
				// If no plot is selected, scroll the history to the end, which
				// will show the most recently generated plot.
				plotHistory.scrollLeft = plotHistory.scrollWidth;
				plotHistory.scrollTop = plotHistory.scrollHeight;
			}
		}
	});

	/**
	 * Renders either a DynamicPlotInstance (resizable plot), a
	 * StaticPlotInstance (static plot image), or a WebviewPlotInstance
	 * (interactive HTML plot) depending on the type of plot instance.
	 *
	 * @param plotInstance The plot instance to render
	 * @returns The rendered component.
	 */
	const render = (plotInstance: IPositronPlotClient) => {
		if (plotInstance instanceof PlotClientInstance) {
			return <DynamicPlotInstance
				key={plotInstance.id}
				height={plotHeight}
				plotClient={plotInstance}
				width={plotWidth}
				zoom={props.zoom} />;
		} else if (plotInstance instanceof StaticPlotClient) {
			return <StaticPlotInstance
				key={plotInstance.id}
				plotClient={plotInstance}
				zoom={props.zoom} />;
		} else if (plotInstance instanceof WebviewPlotClient) {
			return <WebviewPlotInstance
				key={plotInstance.id}
				height={plotHeight}
				plotClient={plotInstance}
				visible={props.visible}
				width={plotWidth} />;
		}
		return null;
	};

	/**
	 * Focuses the plot thumbnail for the given plot ID.
	 * @param plotId The ID of the plot to focus on.
	 */
	const focusPlotThumbnail = (plotId: string) => {
		const plotHistory = plotHistoryRef.current;
		if (!plotHistory) {
			return;
		}
		const plotThumbnailElement = plotHistory.querySelector(
			`.plot-thumbnail[data-plot-id="${plotId}"]`
		) as HTMLButtonElement;
		if (plotThumbnailElement) {
			plotThumbnailElement.focus();
		}
	};

	/**
	 * Focuses the previous plot thumbnail in the history.
	 * @param currentPlotId The ID of the currently selected plot.
	 */
	const focusPreviousPlotThumbnail = (currentPlotId: string) => {
		const currentPlotIndex = positronPlotsContext.positronPlotInstances.findIndex(
			(plotInstance) => plotInstance.id === currentPlotId
		);
		if (currentPlotIndex === -1) {
			return;
		}
		if (currentPlotIndex === 0) {
			return;
		}
		const previousPlotInstance = positronPlotsContext.positronPlotInstances[currentPlotIndex - 1];
		focusPlotThumbnail(previousPlotInstance.id);
	}

	/**
	 * Focuses the next plot thumbnail in the history.
	 * @param currentPlotId The ID of the currently selected plot.
	 */
	const focusNextPlotThumbnail = (currentPlotId: string) => {
		const currentPlotIndex = positronPlotsContext.positronPlotInstances.findIndex(
			(plotInstance) => plotInstance.id === currentPlotId
		);
		if (currentPlotIndex === -1) {
			return;
		}
		if (currentPlotIndex === positronPlotsContext.positronPlotInstances.length - 1) {
			return;
		}
		const nextPlotInstance = positronPlotsContext.positronPlotInstances[currentPlotIndex + 1];
		focusPlotThumbnail(nextPlotInstance.id);
	}

	/**
	 * Renders a thumbnail of either a DynamicPlotInstance (resizable plot), a
	 * StaticPlotInstance (static plot image), or a WebviewPlotInstance
	 * (interactive HTML plot) depending on the type of plot instance.
	 *
	 * @param plotInstance The plot instance to render
	 * @param selected Whether the thumbnail is selected
	 * @returns
	 */
	const renderThumbnail = (plotInstance: IPositronPlotClient, selected: boolean) => {
		const renderThumbnailImage = () => {
			if (plotInstance instanceof PlotClientInstance) {
				return <DynamicPlotThumbnail plotClient={plotInstance} />;
			} else if (plotInstance instanceof StaticPlotClient) {
				return <StaticPlotThumbnail plotClient={plotInstance} />;
			} else if (plotInstance instanceof WebviewPlotClient) {
				return <WebviewPlotThumbnail plotClient={plotInstance} />;
			} else {
				return null;
			}
		};

		return <PlotGalleryThumbnail
			key={plotInstance.id}
			focusNextPlotThumbnail={focusNextPlotThumbnail}
			focusPreviousPlotThumbnail={focusPreviousPlotThumbnail}
			plotClient={plotInstance}
			plotService={positronPlotsContext}
			selected={selected}>
			{renderThumbnailImage()}
		</PlotGalleryThumbnail>;
	};

	// Render the plot history gallery.
	const renderHistory = () => {
		return <div ref={plotHistoryRef} className='plot-history-scroller'>
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
		<div className={'plots-container dark-filter-' + props.darkFilterMode + ' ' + historyEdge}>
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
