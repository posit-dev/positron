/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { DynamicPlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/dynamicPlotInstance';
import { usePositronPlotsContext } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';

/**
 * PlotContainerProps interface.
 */
interface PlotContainerProps {
	width: number;
	height: number;
}

/**
 * PlotContainer component; holds the plot instances.
 *
 * @param props A PlotContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotsContainer = (props: PlotContainerProps) => {

	const positronPlotsContext = usePositronPlotsContext();

	useEffect(() => {
		// Empty for now.
	});

	// If there are no plot instances, show a placeholder; otherwise, show the
	// most recently generated plot.
	//
	// In the future we will probably want to have a filmstrip history of plot
	// instances here for easy navigation.
	return (
		<div className='plots-container'>
			{positronPlotsContext.positronPlotInstances.length === 0 &&
				<span>Plot container: {props.height} x {props.width}</span>}
			{positronPlotsContext.positronPlotInstances.map((plotInstance, index) => (
				index === positronPlotsContext.positronPlotInstances.length - 1 &&
				<DynamicPlotInstance
					key={plotInstance.id}
					width={props.width}
					height={props.height}
					plotClient={plotInstance} />
			))}
		</div>
	);
};
