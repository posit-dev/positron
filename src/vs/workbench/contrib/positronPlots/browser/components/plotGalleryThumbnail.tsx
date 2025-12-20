/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './plotGalleryThumbnail.css';

// React.
import React, { PropsWithChildren, useMemo, useRef } from 'react';

// Other dependencies.
import { IPositronPlotClient } from '../../../../services/positronPlots/common/positronPlots.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * PlotGalleryThumbnailProps interface.
 */
interface PlotGalleryThumbnailProps {
	selected: boolean;
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
	const services = usePositronReactServicesContext();
	const plotThumbnailButtonRef = useRef<HTMLButtonElement>(undefined!);
	const plotRemoveButtonRef = useRef<HTMLButtonElement>(undefined!);

	const selectPlot = () => {
		services.positronPlotsService.selectPlot(props.plotClient.id);
	};

	const removePlot = () => {
		services.positronPlotsService.removePlot(props.plotClient.id);
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

	// Get the plot name from metadata
	const plotName = useMemo(() => {
		return props.plotClient.metadata.name;
	}, [props.plotClient.metadata.name]);

	return (
		<div className={'plot-thumbnail' + (props.selected ? ' selected' : '')}>
			<button
				ref={plotThumbnailButtonRef}
				className='plot-thumbnail-button'
				onClick={selectPlot}
				onKeyDown={handleKeyDown}
			>
				<div className='image-wrapper'>
					{props.children}
				</div>
				{plotName && (
					<div className='plot-thumbnail-name' title={plotName}>
						<span className='plot-thumbnail-name-text'>{plotName}</span>
					</div>
				)}
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
