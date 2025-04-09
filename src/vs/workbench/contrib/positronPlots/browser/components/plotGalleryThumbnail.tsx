/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, useRef } from 'react';

// Other dependencies.
import { PositronPlotsServices } from '../positronPlotsState.js';
import { IPositronPlotClient } from '../../../../services/positronPlots/common/positronPlots.js';

/**
 * PlotGalleryThumbnailProps interface.
 */
interface PlotGalleryThumbnailProps {
	selected: boolean;
	plotService: PositronPlotsServices;
	plotClient: IPositronPlotClient;
	focusPreviousPlotThumbnail: (currentPlotId: string) => void;
	focusNextPlotThumbnail: (currentPlotId: string) => void;
}

/**
 * PlotGalleryThumbnail component. This component renders a thumbnail of a plot
 * instance as a child component, and is used as a wrapper for all plot thumbnails.
 *
 * @param props A PlotGalleryThumbnailProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotGalleryThumbnail = (props: PropsWithChildren<PlotGalleryThumbnailProps>) => {
	const plotThumbnailButtonRef = useRef<HTMLButtonElement>(undefined!);
	const plotRemoveButtonRef = useRef<HTMLButtonElement>(undefined!);

	const selectPlot = () => {
		props.plotService.positronPlotsService.selectPlot(props.plotClient.id);
	};

	const removePlot = () => {
		props.plotService.positronPlotsService.removePlot(props.plotClient.id);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			e.preventDefault();
			props.focusPreviousPlotThumbnail(props.plotClient.id);
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			e.preventDefault();
			props.focusNextPlotThumbnail(props.plotClient.id);
		} else if (e.key === 'Enter' || e.key === ' ') {
			// if the focus is on the remove button, call the removePlot function
			if (e.target === plotRemoveButtonRef.current) {
				if (e.key === 'Enter' || e.key === ' ') {
					removePlot();
				}
				return;
			}
			// otherwise, we are on the thumbnail button and we want to select
			// the plot and focus the thumbnail
			selectPlot();
			if (plotThumbnailButtonRef.current) {
				plotThumbnailButtonRef.current.focus();
			}
		} else {
			return;
		}
	};

	return (
		<div
			className={'plot-thumbnail' + (props.selected ? ' selected' : '')}
			data-plot-id={props.plotClient.id}
			tabIndex={-1}
			onKeyDown={handleKeyDown}
		>
			<button
				ref={plotThumbnailButtonRef}
				className='image-wrapper'
				tabIndex={props.selected ? 0 : -1}
				onClick={selectPlot}
			>
				{props.children}
			</button>
			<button
				ref={plotRemoveButtonRef}
				className='plot-close codicon codicon-close'
				tabIndex={props.selected ? 0 : -1}
				onClick={removePlot}
			>
			</button>
		</div>
	);
};
