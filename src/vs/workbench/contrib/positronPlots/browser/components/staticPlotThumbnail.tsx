/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PositronPlotsServices } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsState';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

/**
 * StaticPlotThumbnailProps interface.
 */
interface StaticPlotThumbnailProps {
	selected: boolean;
	plotService: PositronPlotsServices;
	plotClient: StaticPlotClient;
}

/**
 * StaticPlotThumbnail component. This component renders a thumbnail of a plot instance.
 *
 * @param props A StaticPlotThumbnailProps that contains the component properties.
 * @returns The rendered component.
 */
export const StaticPlotThumbnail = (props: StaticPlotThumbnailProps) => {

	const selectPlot = () => {
		props.plotService.positronPlotsService.selectPlot(props.plotClient.id);
	};

	const removePlot = () => {
		props.plotService.positronPlotsService.removePlot(props.plotClient.id);
	};

	return (
		<div className={'plot-thumbnail' + (props.selected ? ' selected' : '')}>
			<button className='image-wrapper'>
				<img src={props.plotClient.uri} alt={'Plot ' + props.plotClient.id}
					onClick={selectPlot} />
			</button>
			<button className='plot-close codicon codicon-close' onClick={removePlot}></button>
		</div>
	);
};
