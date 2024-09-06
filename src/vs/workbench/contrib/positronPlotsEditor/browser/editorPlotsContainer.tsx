/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DynamicPlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/dynamicPlotInstance';
import { StaticPlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/staticPlotInstance';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

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
