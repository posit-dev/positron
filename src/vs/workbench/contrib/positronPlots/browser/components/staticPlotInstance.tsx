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
	const [grabbing, setGrabbing] = React.useState<boolean>(false);

	const onImgLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
		const img = event.target as HTMLImageElement;
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		setWidth(width);
		setHeight(height);
	};

	React.useEffect(() => {
		const { clientWidth, clientHeight } = imageWrapperRef.current ?? { clientWidth: 0, clientHeight: 0 };
		setMoveX((clientWidth - (width * props.zoom)) / 2);
		setMoveY((clientHeight - (height * props.zoom)) / 2);
	}, [width, height, props.zoom]);

	React.useLayoutEffect(() => {
		if (!imageWrapperRef.current || props.zoom === ZoomLevel.Fill) {
			return;
		}
	});

	const getStyle = (): React.CSSProperties => {
		const panMovement = `translateX(${moveX}px) translateY(${moveY}px)`;
		let style: React.CSSProperties = {};

		if (props.zoom === ZoomLevel.Fill) {
			// no centering and let the entire plot be visible
			style = {
				width: '100%',
				height: '100%',
				position: 'unset',
				transform: 'none',
			};
		} else {
			style = {
				cursor: grabbing ? 'grabbing' : 'grab',
				maxWidth: 'none',
				maxHeight: 'none',
				top: 0,
				left: 0,
				transform: panMovement,
			};
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
		if (event.type === 'wheel') {
			const wheelEvent = event as React.WheelEvent<HTMLImageElement>;
			console.log(`Wheel event: ${wheelEvent.deltaX}, ${wheelEvent.deltaY}`);
			setMoveX(moveX + wheelEvent.deltaX);
			setMoveY(moveY + wheelEvent.deltaY);
			return;
		}
		if (event.buttons !== 1 || props.zoom === ZoomLevel.Fill) {
			return;
		}
		console.log(`Mouse event: ${event.movementX}, ${event.movementY}`);
		setMoveX(moveX + event.movementX);
		setMoveY(moveY + event.movementY);
	};

	const updateCursor = (event: React.MouseEvent<HTMLImageElement>) => {
		setGrabbing(event.type === 'mousedown');
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
					onMouseDown={updateCursor}
					onMouseUp={updateCursor}
					onWheel={panImage}
					draggable={false}
				/>
			</div>
		</div>);
};
