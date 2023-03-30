/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * PlotInstanceProps interface.
 */
interface PlotInstanceProps {
	width: number;
	height: number;
	plotClient: PlotClientInstance;
}

/**
 * PlotInstance component. This component renders a single plot in the Plots
 * pane.
 *
 * @param props A PlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotInstance = (props: PlotInstanceProps) => {

	const [uri, setUri] = useState('');

	useEffect(() => {
		const ratio = window.devicePixelRatio;
		props.plotClient.render(props.width, props.height, ratio).then((result) => {
			setUri(`data:${result.mime_type};base64,${result.data}`);
		});
	});

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered plot.
	//
	// Consider: we probably want a more explicit loading state; as written we
	// will show the old URI until the new one is ready.
	return (
		<div className='plot-instance'>
			{uri &&
				<img src={uri}
					height={props.height}
					width={props.width}
					alt={'Plot ' + props.plotClient.id} />}
			{!uri && <span>Rendering plot {props.plotClient.id}: {props.height} x {props.width}</span>}
		</div>
	);
};
