/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { DynamicPlotInstance } from '../../positronPlots/browser/components/dynamicPlotInstance.js';
import { StaticPlotInstance } from '../../positronPlots/browser/components/staticPlotInstance.js';
import { ZoomLevel } from '../../positronPlots/browser/components/zoomPlotMenuButton.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotClient } from '../../../services/positronPlots/common/positronPlots.js';
import { StaticPlotClient } from '../../../services/positronPlots/common/staticPlotClient.js';

interface EditorPlotsContainerProps {
	plotClient: IPositronPlotClient;
	height: number;
	width: number;
}

export const EditorPlotsContainer = (props: EditorPlotsContainerProps) => {
	const render = () => {
		if (props.plotClient instanceof PlotClientInstance) {
			return <DynamicPlotInstance
				key={props.plotClient.id}
				height={props.height}
				width={props.width}
				plotClient={props.plotClient}
				zoom={ZoomLevel.Fit} />;
		}
		if (props.plotClient instanceof StaticPlotClient) {
			return <StaticPlotInstance
				key={props.plotClient.id}
				plotClient={props.plotClient}
				zoom={ZoomLevel.OneHundred} />;
		}

		return null;
	};

	return (
		<div style={
			{
				width: props.width,
				height: props.height
			}
		}>
			{render()}
		</div>
	);
};
