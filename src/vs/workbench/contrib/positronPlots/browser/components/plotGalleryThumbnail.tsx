/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronPlotsServices } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsState';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

/**
 * PlotGalleryThumbnailProps interface.
 */
interface PlotGalleryThumbnailProps {
	selected: boolean;
	plotService: PositronPlotsServices;
	plotClient: IPositronPlotClient;
}

/**
 * PlotGalleryThumbnail component. This component renders a thumbnail of a plot
 * instance as a child component, and is used as a wrapper for all plot thumbnails.
 *
 * @param props A PlotGalleryThumbnailProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotGalleryThumbnail = (props: PropsWithChildren<PlotGalleryThumbnailProps>) => {

	const selectPlot = () => {
		props.plotService.positronPlotsService.selectPlot(props.plotClient.id);
	};

	const removePlot = () => {
		props.plotService.positronPlotsService.removePlot(props.plotClient.id);
	};

	return (
		<div className={'plot-thumbnail' + (props.selected ? ' selected' : '')}>
			<button className='image-wrapper' onClick={selectPlot}>
				{props.children}
			</button>
			<button className='plot-close codicon codicon-close' onClick={removePlot}></button>
		</div>
	);
};
