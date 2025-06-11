/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './editorPlotsContainer.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { DynamicPlotInstance } from '../../positronPlots/browser/components/dynamicPlotInstance.js';
import { StaticPlotInstance } from '../../positronPlots/browser/components/staticPlotInstance.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotClient, IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { StaticPlotClient } from '../../../services/positronPlots/common/staticPlotClient.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

interface EditorPlotsContainerProps {
	plotClient: IPositronPlotClient;
	positronPlotsService: IPositronPlotsService,
	height: number;
	width: number;
}

export const EditorPlotsContainer = (props: EditorPlotsContainerProps) => {

	const [zoomLevel, setZoomLevel] = useState(props.plotClient.metadata.zoom_level);
	const [darkFilterMode, setDarkFilterMode] = useState(props.positronPlotsService.darkFilterMode);

	const render = () => {
		if (props.plotClient instanceof PlotClientInstance) {
			return <DynamicPlotInstance
				key={props.plotClient.id}
				height={props.height}
				plotClient={props.plotClient}
				width={props.width}
				zoom={zoomLevel} />;
		}
		if (props.plotClient instanceof StaticPlotClient) {
			return <StaticPlotInstance
				key={props.plotClient.id}
				plotClient={props.plotClient}
				zoom={zoomLevel} />;
		}
		return null;
	};

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the event handler for dark filter mode changes.
		disposableStore.add(props.positronPlotsService.onDidChangeDarkFilterMode(mode => {
			setDarkFilterMode(mode);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.positronPlotsService]);

	// Monitor zoom level changes
	useEffect(() => {
		// listen to the plots service for zoom level changes
		const disposable = props.positronPlotsService.onDidChangePlotZoom(({ plotId, zoomLevel }) => {
			if (plotId !== props.plotClient.id) {
				return;
			}

			// Update the zoom level state
			setZoomLevel(zoomLevel);
		});

		return () => {
			// Clean up the event listener when the component unmounts
			disposable.dispose();
		}
	}, [props.plotClient.id, props.positronPlotsService]);

	return (
		<div className={`dark-filter-${darkFilterMode} ${props.plotClient.metadata.zoom_level}`} style={
			{
				width: props.width,
				height: props.height
			}
		}>
			{render()}
		</div>
	);
};
