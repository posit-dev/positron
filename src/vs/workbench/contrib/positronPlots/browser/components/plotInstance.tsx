/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
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

	useEffect(() => {
	});

	return (
		<div className='plot-instance'>
			Plot, width: {props.width}, height: {props.height}
		</div>
	);
};
