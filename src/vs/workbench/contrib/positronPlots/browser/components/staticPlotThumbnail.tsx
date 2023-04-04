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
	plotService: PositronPlotsServices;
	plotIndex: number;
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
		props.plotService.positronPlotsService.selectPlot(props.plotIndex);
	};

	return (
		<div className='plot-thumbnail'>
			<div className='image-wrapper'>
				<img src={props.plotClient.uri} alt={'Plot ' + props.plotClient.id}
					onClick={selectPlot} />
			</div>
		</div>
	);
};
