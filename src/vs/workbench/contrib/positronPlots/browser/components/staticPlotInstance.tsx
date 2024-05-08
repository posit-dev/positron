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
	const [moveX, setMoveX] = React.useState<number>(0);
	const [moveY, setMoveY] = React.useState<number>(0);

	const onImgLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
		const img = event.target as HTMLImageElement;
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		setWidth(width);
		setHeight(height);
	};

	React.useEffect(() => {
		const { clientWidth, clientHeight } = imageWrapperRef.current ?? { clientWidth: 0, clientHeight: 0 };
		if (clientWidth > width) {
			setMoveX(0);
		} else {
			setMoveX(-width / 2 * props.zoom);
		}
		if (clientHeight > height) {
			setMoveY(0);
		} else {
			setMoveY(-height / 2 * props.zoom);
		}
	}, [width, height, props.zoom]);

	React.useLayoutEffect(() => {
		if (!imageWrapperRef.current || props.zoom === ZoomLevel.Fill) {
			return;
		}
	});

	const getStyle = (): React.CSSProperties => {
		const { clientWidth, clientHeight } = imageWrapperRef.current ?? { clientWidth: 0, clientHeight: 0 };
		let style: React.CSSProperties = {};

		const wide = width * props.zoom > clientWidth;
		const tall = height * props.zoom > clientHeight;

		const panMovement = `translateX(${moveX}px) translateY(${moveY}px)`;

		style = {
			cursor: 'grab',
			maxWidth: 'none',
			maxHeight: 'none',
		};

		switch (props.zoom) {
			case ZoomLevel.Fifty:
			case ZoomLevel.SeventyFive:
			case ZoomLevel.OneHundred:
			case ZoomLevel.TwoHundred:
				if (wide && tall) {
					// If the plot is wider and taller than the container, no centering is needed.
					style = {
						...style,
						...{
							top: '0px',
							left: '0px',
							transform: panMovement,
						}
					};
				} else if (wide && !tall) {
					// If the plot is wider than the container, center it vertically.
					style = {
						...style, ...{
							top: '50%',
							left: '0px',
							transform: panMovement,
						}
					};
				} else if (tall && !wide) {
					// If the plot is taller than the container, center it horizontally.
					style = {
						...style, ...{
							top: '0px',
							left: '50%',
							transform: panMovement,
						}
					};
				} else {
					// If the plot is smaller than the container, center it both horizontally and vertically.
					style = {
						...style, ...{
							top: '50%',
							left: '50%',
							transform: panMovement,
						}
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
			return `${value * props.zoom}px`;
		}

		return '100%';
	};

	const panImage = (event: React.MouseEvent<HTMLImageElement>) => {
		if (event.buttons !== 1 || props.zoom === ZoomLevel.Fill) {
			return;
		}
		setMoveX(moveX + event.movementX);
		setMoveY(moveY + event.movementY);
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
					onMouseMoveCapture={panImage}
					draggable={false}
				/>
			</div>
		</div>);
};
