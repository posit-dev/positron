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
 * PlotInstance component.
 * @param props A PlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotInstance = (props: PlotInstanceProps) => {

	const [uri, setUri] = useState('');

	useEffect(() => {
		props.plotClient.render(props.width, props.height, 200).then((result) => {
			setUri(`data:${result.mime_type};base64,${result.data}`);
		});
	});

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
