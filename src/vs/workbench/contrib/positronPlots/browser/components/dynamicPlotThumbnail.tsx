/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronPlotsServices } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsState';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * DynamicPlotThumbnailProps interface.
 */
interface DynamicPlotThumbnailProps {
	selected: boolean;
	plotService: PositronPlotsServices;
	plotClient: PlotClientInstance;
}

/**
 * DynamicPlotThumbnail component. This component renders a thumbnail of a plot instance.
 *
 * @param props A DynamicPlotThumbnailProps that contains the component properties.
 * @returns The rendered component.
 */
export const DynamicPlotThumbnail = (props: DynamicPlotThumbnailProps) => {

	const [uri, setUri] = useState('');

	useEffect(() => {
		// If the plot is already rendered, show the URI; otherwise, wait for
		// the plot to render.
		if (props.plotClient.lastRender) {
			setUri(props.plotClient.lastRender.uri);
		}

		// When the plot is rendered, update the URI. This can happen multiple times if the plot
		// is resized.
		props.plotClient.onDidCompleteRender((result) => {
			setUri(result.uri);
		});
	});

	const selectPlot = () => {
		props.plotService.positronPlotsService.selectPlot(props.plotClient.id);
	};

	const removePlot = () => {
		props.plotService.positronPlotsService.removePlot(props.plotClient.id);
	};

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered plot.
	//
	// Consider: we probably want a more explicit loading state; as written we
	// will show the old URI until the new one is ready.
	return (
		<div className={'plot-thumbnail' + (props.selected ? ' selected' : '')}>
			{uri && <div className='image-wrapper'>
				<img src={uri} alt={'Plot ' + props.plotClient.id}
					onClick={selectPlot} />
			</div>}
			{!uri && <div className='plot-thumbnail-placeholder' onClick={selectPlot}></div>}
			<div className='plot-close codicon codicon-close' onClick={removePlot}></div>
		</div>
	);
};
