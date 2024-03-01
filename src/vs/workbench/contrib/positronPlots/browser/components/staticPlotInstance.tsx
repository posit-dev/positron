/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

/**
 * StaticPlotInstanceProps interface.
 */
interface StaticPlotInstanceProps {
	plotClient: StaticPlotClient;
	zoom: ZoomLevel;
}

/**
 * StaticPlotInstance component. This component renders a single static (unchanging) plot
 * in the Plots pane.
 *
 * Unlike a DynamicPlotInstance, a StaticPlotInstance cannot redraw or resize itself. It renders
 * a static image at a fixed size.
 *
 * @param props A StaticPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const StaticPlotInstance = (props: StaticPlotInstanceProps) => {
	const [width, setWidth] = React.useState<number>(1);
	const [height, setHeight] = React.useState<number>(1);
	const imageWrapperRef = React.useRef<HTMLDivElement>(null);
	const [zoomMultiplier, setZoomMultiplier] = React.useState<number>(1);

	const onImgLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
		const img = event.target as HTMLImageElement;
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		setWidth(width);
		setHeight(height);
	};

	React.useEffect(() => {
		setZoomMultiplier(props.zoom.valueOf());
	}, [props.zoom]);

	React.useLayoutEffect(() => {
		if (!imageWrapperRef.current || props.zoom === ZoomLevel.Fill) {
			return;
		}
	});

	const getStyle = (): React.CSSProperties => {
		const { clientWidth, clientHeight } = imageWrapperRef.current ?? { clientWidth: 0, clientHeight: 0 };
		let style: React.CSSProperties = {};

		const wide = width * zoomMultiplier > clientWidth;
		const tall = height * zoomMultiplier > clientHeight;

		switch (props.zoom) {
			case ZoomLevel.Fifty:
			case ZoomLevel.SeventyFive:
			case ZoomLevel.OneHundred:
			case ZoomLevel.TwoHundred:
				if (wide && tall) {
					// If the plot is wider and taller than the container, no centering is needed.
					style = {
						maxWidth: 'none',
						maxHeight: 'none',
						top: '0px',
						left: '0px',
						transform: 'none',
					};
				} else if (wide && !tall) {
					// If the plot is wider than the container, center it vertically.
					style = {
						maxWidth: 'none',
						maxHeight: 'none',
						top: '50%',
						left: '0px',
						transform: 'translateY(-50%)',
					};
				} else if (tall && !wide) {
					// If the plot is taller than the container, center it horizontally.
					style = {
						maxWidth: 'none',
						maxHeight: 'none',
						top: '0px',
						left: '50%',
						transform: 'translateX(-50%)',
					};
				} else {
					// If the plot is smaller than the container, center it both horizontally and vertically.
					style = {
						maxWidth: 'none',
						maxHeight: 'none',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
					};
				}
				break;
			case ZoomLevel.Fill:
			default:
				// no centering and let the entire plot be visible
				style = {
					width: '100%',
					height: '100%',
					position: 'unset',
					transform: 'none',
				};
				break;
		}
		return style;
	};

	const applyZoom = (value: number): string => {
		if (props.zoom !== ZoomLevel.Fill) {
			return `${value * zoomMultiplier}px`;
		}

		return '100%';
	};

	return (
		<div className='plot-instance static-plot-instance'>
			<div className='image-wrapper' ref={imageWrapperRef}>
				<img src={props.plotClient.uri}
					alt={props.plotClient.code ? props.plotClient.code : 'Plot ' + props.plotClient.id}
					onLoad={onImgLoad}
					style={getStyle()}
					width={applyZoom(width)}
					height={applyZoom(height)}
				/>
			</div>
		</div>);
};
