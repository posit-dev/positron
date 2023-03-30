/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { PlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/plotInstance';
import { usePositronPlotsContext } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';

/**
 * PlotContainerProps interface.
 */
interface PlotContainerProps {
	width: number;
	height: number;
}

/**
 * PlotContainer component.
 *
 * @param props A PlotContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotsContainer = (props: PlotContainerProps) => {

	const positronPlotsContext = usePositronPlotsContext();

	useEffect(() => {
	});

	return (
		<div className='plots-container'>
			{positronPlotsContext.positronPlotInstances.length === 0 &&
				<span>Plot container: {props.height} x {props.width}</span>}
			{positronPlotsContext.positronPlotInstances.map((plotInstance, index) => (
				index === positronPlotsContext.positronPlotInstances.length - 1 &&
				<PlotInstance
					key={plotInstance.id}
					width={props.width}
					height={props.height}
					plotClient={plotInstance} />
			))}
		</div>
	);
};
