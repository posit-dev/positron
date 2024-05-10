/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { isMacintosh } from 'vs/base/common/platform';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';

interface PanZoomImageProps {
	imageUri: string;
	description: string;
	zoom: ZoomLevel;
}

/**
 * A component to pan the image using mouse drag or wheel
 * and set the image zoom (scale multiplier).
 * @param props A PanZoomImageProps that contains the component properties.
 * @returns The rendered component.
 */
export const PanZoomImage = (props: PanZoomImageProps) => {
	const [width, setWidth] = React.useState<number>(1);
	const [height, setHeight] = React.useState<number>(1);
	const imageWrapperRef = React.useRef<HTMLDivElement>(null);
	const [moveX, setMoveX] = React.useState<number>(0);
	const [moveY, setMoveY] = React.useState<number>(0);
	const [grabbing, setGrabbing] = React.useState<boolean>(false);

	const reverseScroll = isMacintosh;

	React.useEffect(() => {
		// centers the image
		const { clientWidth, clientHeight } = imageWrapperRef.current ?? { clientWidth: 0, clientHeight: 0 };
		setMoveX((clientWidth - (width * props.zoom)) / 2);
		setMoveY((clientHeight - (height * props.zoom)) / 2);
	}, [width, height, props.zoom]);

	const getStyle = (): React.CSSProperties => {
		let style: React.CSSProperties = {};

		if (props.zoom === ZoomLevel.Fill) {
			// no translation added and let the entire plot be visible
			style = {
				width: '100%',
				height: '100%',
				position: 'unset',
				transform: 'none',
			};
		} else {
			const panMovement = `translateX(${moveX}px) translateY(${moveY}px)`;
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
	const onImgLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
		const img = event.target as HTMLImageElement;
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		setWidth(width);
		setHeight(height);
	};

	const applyZoom = (value: number): string => {
		if (props.zoom !== ZoomLevel.Fill) {
			return `${value * props.zoom}px`;
		}

		return '100%';
	};

	const panImage = (event: React.MouseEvent<HTMLElement>) => {
		const { clientWidth, clientHeight } = imageWrapperRef.current ?? { clientWidth: 0, clientHeight: 0 };
		const adjustedWidth = width * props.zoom;
		const adjustedHeight = height * props.zoom;

		// Clamp the movement to the parent's boundaries
		const maxMoveX = adjustedWidth > clientWidth ? 0 : clientWidth - adjustedWidth;
		const minMoveX = adjustedWidth > clientWidth ? -adjustedWidth + clientWidth : 0;
		const maxMoveY = adjustedHeight > clientHeight ? 0 : clientHeight - adjustedHeight;
		const minMoveY = adjustedHeight > clientHeight ? -adjustedHeight + clientHeight : 0;

		let newMoveX = 0, newMoveY = 0;

		if (event.type === 'wheel' && event.buttons === 0) {
			const wheelEvent = event as React.WheelEvent<HTMLImageElement>;

			// Adds the reverse scroll effect if on Mac
			newMoveX = moveX + (reverseScroll ? -wheelEvent.deltaX : wheelEvent.deltaX);
			newMoveY = moveY + (reverseScroll ? -wheelEvent.deltaY : wheelEvent.deltaY);
		} else if (event.buttons === 1 && props.zoom !== ZoomLevel.Fill) {
			newMoveX = moveX + event.movementX;
			newMoveY = moveY + event.movementY;
		} else {
			return;
		}

		const finalMoveX = Math.max(Math.min(newMoveX, maxMoveX), minMoveX);
		const finalMoveY = Math.max(Math.min(newMoveY, maxMoveY), minMoveY);
		setMoveX(finalMoveX);
		setMoveY(finalMoveY);
	};

	const updateCursor = (event: React.MouseEvent<HTMLElement>) => {
		setGrabbing(event.type === 'mousedown');
	};

	return (
		<div className='image-wrapper'
			ref={imageWrapperRef}
			onMouseMoveCapture={panImage}
			onMouseDown={updateCursor}
			onMouseUp={updateCursor}
			onWheel={panImage}
		>
			<img src={props.imageUri}
				alt={props.description}
				onLoad={onImgLoad}
				style={getStyle()}
				width={applyZoom(width)}
				height={applyZoom(height)}
				draggable={false}
			/>
		</div>
	);
};
