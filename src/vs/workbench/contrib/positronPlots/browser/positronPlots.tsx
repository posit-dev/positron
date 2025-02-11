/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronPlots.css';

// React.
import React, { PropsWithChildren, useCallback, useEffect, useState } from 'react';

// Other dependencies.
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { PositronPlotsServices } from './positronPlotsState.js';
import { PositronPlotsContextProvider } from './positronPlotsContext.js';
import { HistoryPolicy, IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PlotsContainer } from './components/plotsContainer.js';
import { ActionBars } from './components/actionBars.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { PositronPlotsViewPane } from './positronPlotsView.js';
import { ZoomLevel } from './components/zoomPlotMenuButton.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';

/**
 * PositronPlotsProps interface.
 */
export interface PositronPlotsProps extends PositronPlotsServices {
	// Services.
	readonly layoutService: IWorkbenchLayoutService;
	readonly reactComponentContainer: PositronPlotsViewPane;
	readonly positronPlotsService: IPositronPlotsService;
	readonly notificationService: INotificationService;
	readonly preferencesService: IPreferencesService;
}

/**
 * PositronPlots component.
 * @param props A PositronPlotsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronPlots = (props: PropsWithChildren<PositronPlotsProps>) => {

	// Compute the history visibility based on the history policy.
	const computeHistoryVisibility = useCallback((policy: HistoryPolicy) => {
		switch (policy) {
			case HistoryPolicy.AlwaysVisible:
				return true;
			case HistoryPolicy.NeverVisible:
				return false;
			case HistoryPolicy.Automatic:
				// Don't show the history if there aren't at least two plots.
				if (props.positronPlotsService.positronPlotInstances.length < 2) {
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
	}, [props.positronPlotsService.positronPlotInstances.length, props.reactComponentContainer.height, props.reactComponentContainer.width]);

	const zoomHandler = (zoom: number) => {
		setZoom(zoom);
	};

	// Hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);
	const [posX, setPosX] = useState(0);
	const [posY, setPosY] = useState(0);
	const [visible, setVisible] = useState(props.reactComponentContainer.containerVisible);
	const [showHistory, setShowHistory] = useState(computeHistoryVisibility(
		props.positronPlotsService.historyPolicy));
	const [darkFilterMode, setDarkFilterMode] = useState(props.positronPlotsService.darkFilterMode);
	const [zoom, setZoom] = useState(ZoomLevel.Fit);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
			setShowHistory(computeHistoryVisibility(props.positronPlotsService.historyPolicy));
		}));

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onPositionChanged(pos => {
			setPosX(pos.x);
			setPosY(pos.y);
		}));

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visible => {
			setVisible(visible);
		}));

		// Add event handlers so we can show/hide the history portion of the panel as the set
		// of plots changes.
		disposableStore.add(props.positronPlotsService.onDidEmitPlot(() => {
			setShowHistory(computeHistoryVisibility(props.positronPlotsService.historyPolicy));
		}));
		disposableStore.add(props.positronPlotsService.onDidRemovePlot(() => {
			setShowHistory(computeHistoryVisibility(props.positronPlotsService.historyPolicy));
		}));
		disposableStore.add(props.positronPlotsService.onDidReplacePlots(() => {
			setShowHistory(computeHistoryVisibility(props.positronPlotsService.historyPolicy));
		}));

		// Add the event handler for history policy changes.
		disposableStore.add(props.positronPlotsService.onDidChangeHistoryPolicy(policy => {
			setShowHistory(computeHistoryVisibility(policy));
		}));

		// Add the event handler for dark filter mode changes.
		disposableStore.add(props.positronPlotsService.onDidChangeDarkFilterMode(mode => {
			setDarkFilterMode(mode);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [computeHistoryVisibility, props.positronPlotsService, props.reactComponentContainer]);

	// Render.
	return (
		<PositronPlotsContextProvider {...props}>
			<ActionBars {...props} zoomHandler={zoomHandler} zoomLevel={zoom} />
			<PlotsContainer
				darkFilterMode={darkFilterMode}
				height={height - 34}
				showHistory={showHistory}
				visible={visible}
				width={width}
				x={posX}
				y={posY}
				zoom={zoom} />
		</PositronPlotsContextProvider>
	);

};
