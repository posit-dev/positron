/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * DynamicPlotInstanceProps interface.
 */
interface DynamicPlotInstanceProps {
	width: number;
	height: number;
	plotClient: PlotClientInstance;
}

/**
 * DynamicPlotInstance component. This component renders a single dynamic plot
 * in the Plots pane.
 *
 * Unlike a StaticPlotInstance, a DynamicPlotInstance can redraw itself when
 * the plot size changes. It wraps a PlotClientInstance, which is responsible
 * for generating the plot data.
 *
 * @param props A DynamicPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const DynamicPlotInstance = (props: DynamicPlotInstanceProps) => {

	const [uri, setUri] = useState('');

	useEffect(() => {
		const ratio = window.devicePixelRatio;
		props.plotClient.render(props.height, props.width, ratio).then((result) => {
			setUri(result.uri);
		});
	});

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered plot.
	//
	// Consider: we probably want a more explicit loading state; as written we
	// will show the old URI until the new one is ready.
	return (
		<div className='dynamic-plot-instance'>
			{uri &&
				<img src={uri}
					height={props.height}
					width={props.width}
					alt={props.plotClient.code ? props.plotClient.code : 'Plot ' + props.plotClient.id} />}
			{!uri && <span>Rendering plot {props.plotClient.id}: {props.height} x {props.width}</span>}
		</div>
	);
};
