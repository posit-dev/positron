/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronPlots';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronPlotsServices } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsState';
import { PositronPlotsContextProvider } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';
import { HistoryPolicy, IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PlotsContainer } from 'vs/workbench/contrib/positronPlots/browser/components/plotsContainer';
import { ActionBars } from 'vs/workbench/contrib/positronPlots/browser/components/actionBars';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { PositronPlotsViewPane } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsView';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';

/**
 * PositronPlotsProps interface.
 */
export interface PositronPlotsProps extends PositronPlotsServices {
	// Services.
	readonly layoutService: IWorkbenchLayoutService;
	readonly reactComponentContainer: PositronPlotsViewPane;
	readonly positronPlotsService: IPositronPlotsService;
	readonly notificationService: INotificationService;
}

/**
 * PositronPlots component.
 * @param props A PositronPlotsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronPlots = (props: PropsWithChildren<PositronPlotsProps>) => {

	// Compute the history visibility based on the history policy.
	const computeHistoryVisibility = (policy: HistoryPolicy) => {
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
	};

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

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<PositronPlotsContextProvider {...props}>
			<ActionBars {...props} zoomHandler={zoomHandler} zoomLevel={zoom} />
			<PlotsContainer
				showHistory={showHistory}
				visible={visible}
				width={width}
				height={height - 34}
				x={posX}
				y={posY}
				zoom={zoom} />
		</PositronPlotsContextProvider>
	);

};
