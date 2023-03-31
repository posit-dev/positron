/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

/**
 * StaticPlotInstanceProps interface.
 */
interface StaticPlotInstanceProps {
	plotClient: StaticPlotClient;
}

/**
 * StaticPlotInstance component. This component renders a single static (unchanging) plot
 * in the Plots pane.
 *
 * Unlike a DynamicPlotInstance, a StaticPlotInstance cannot redraw or resize itself. It renders
 * a static image at a fixed size.
 *
 * @param props A StaticPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const StaticPlotInstance = (props: StaticPlotInstanceProps) => {
	return (
		<div className='static-plot-instance'>
			<img src={props.plotClient.uri}
				alt={'Plot ' + props.plotClient.id} />
		</div>);
};
