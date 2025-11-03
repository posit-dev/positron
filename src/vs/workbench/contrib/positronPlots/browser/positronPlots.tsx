/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronPlots.css';

// React.
import React, { PropsWithChildren, useCallback, useEffect, useState } from 'react';

// Other dependencies.
import { PositronPlotsContextProvider } from './positronPlotsContext.js';
import { HistoryPolicy, isZoomablePlotClient, ZoomLevel } from '../../../services/positronPlots/common/positronPlots.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PlotsContainer } from './components/plotsContainer.js';
import { ActionBars } from './components/actionBars.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * PositronPlotsProps interface.
 */
export interface PositronPlotsProps {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronPlots component.
 * @param props A PositronPlotsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronPlots = (props: PropsWithChildren<PositronPlotsProps>) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Compute the history visibility based on the history policy.
	const computeHistoryVisibility = useCallback((policy: HistoryPolicy) => {
		switch (policy) {
			case HistoryPolicy.AlwaysVisible:
				return true;
			case HistoryPolicy.NeverVisible:
				return false;
			case HistoryPolicy.Automatic:
				// Don't show the history if there aren't at least two plots.
				if (services.positronPlotsService.positronPlotInstances.length < 2) {
					return false;
				}

				// Don't show the history if the container is too small.
				if (props.reactComponentContainer.width < 300 ||
					props.reactComponentContainer.height < 300) {
					return false;
				}

				// Show the history.
				return true;
		}
	}, [services.positronPlotsService.positronPlotInstances.length, props.reactComponentContainer.height, props.reactComponentContainer.width]);

	const zoomHandler = (zoom: number) => {
		const currentPlotId = services.positronPlotsService.selectedPlotId;
		if (!currentPlotId) {
			return;
		}

		const plot = services.positronPlotsService.positronPlotInstances.find(plot => plot.id === currentPlotId);
		if (isZoomablePlotClient(plot)) {
			// Update the zoom level in the plot metadata.
			plot.zoomLevel = zoom;
		}
	};

	// Hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);
	const [posX, setPosX] = useState(0);
	const [posY, setPosY] = useState(0);
	const [visible, setVisible] = useState(props.reactComponentContainer.containerVisible);
	const [showHistory, setShowHistory] = useState(computeHistoryVisibility(services.positronPlotsService.historyPolicy));
	const [darkFilterMode, setDarkFilterMode] = useState(services.positronPlotsService.darkFilterMode);
	const [zoom, setZoom] = useState(ZoomLevel.Fit);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
			setShowHistory(computeHistoryVisibility(services.positronPlotsService.historyPolicy));
		}));

		// Add the onPositionChanged event handler (if available).
		if (props.reactComponentContainer.onPositionChanged) {
			disposableStore.add(props.reactComponentContainer.onPositionChanged(pos => {
				setPosX(pos.x);
				setPosY(pos.y);
			}));
		}

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visible => {
			setVisible(visible);
		}));

		// Add event handlers so we can show/hide the history portion of the panel as the set
		// of plots changes.
		disposableStore.add(services.positronPlotsService.onDidEmitPlot(() => {
			setShowHistory(computeHistoryVisibility(services.positronPlotsService.historyPolicy));
		}));
		disposableStore.add(services.positronPlotsService.onDidRemovePlot(() => {
			setShowHistory(computeHistoryVisibility(services.positronPlotsService.historyPolicy));
		}));
		disposableStore.add(services.positronPlotsService.onDidReplacePlots(() => {
			setShowHistory(computeHistoryVisibility(services.positronPlotsService.historyPolicy));
		}));

		// Add the event handler for history policy changes.
		disposableStore.add(services.positronPlotsService.onDidChangeHistoryPolicy(policy => {
			setShowHistory(computeHistoryVisibility(policy));
		}));

		// Add the event handler for dark filter mode changes.
		disposableStore.add(services.positronPlotsService.onDidChangeDarkFilterMode(mode => {
			setDarkFilterMode(mode);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [computeHistoryVisibility, services.positronPlotsService, props.reactComponentContainer]);

	useEffect(() => {
		// Set the initial zoom level for the current plot.
		const disposableStore = new DisposableStore();

		disposableStore.add(services.positronPlotsService.onDidSelectPlot(plotId => {
			const currentPlot = services.positronPlotsService.selectedPlotId;

			if (currentPlot) {
				const plot = services.positronPlotsService.positronPlotInstances.find(plot => plot.id === currentPlot);
				if (isZoomablePlotClient(plot)) {
					disposableStore.add(plot.onDidChangeZoomLevel((zoomLevel) => {
						setZoom(zoomLevel);
					}));
					setZoom(plot.zoomLevel);
				} else {
					setZoom(ZoomLevel.Fit);
				}
			}
		}));

		return () => {
			// Dispose of the disposable store to clean up event handlers.
			disposableStore.dispose();
		}
	}, [services.positronPlotsService]);

	// Render.
	return (
		<PositronPlotsContextProvider {...props}>
			<ActionBars
				{...props}
				key={services.positronPlotsService.selectedPlotId}
				zoomHandler={zoomHandler}
				zoomLevel={zoom}
			/>
			<PlotsContainer
				darkFilterMode={darkFilterMode}
				height={height > 0 ? height - 34 : 0}
				showHistory={showHistory}
				visible={visible}
				width={width}
				x={posX}
				y={posY}
			/>
		</PositronPlotsContextProvider>
	);

};
