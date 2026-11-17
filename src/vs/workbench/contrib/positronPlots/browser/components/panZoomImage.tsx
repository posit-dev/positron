/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { Scrollable } from '../../../../../base/browser/ui/positronComponents/scrollable/Scrollable.js';
import { PlotPoint } from '../../../../services/languageRuntime/common/positronUiComm.js';
import { plotPointFromClick } from '../../../../services/positronPlots/common/plotLocator.js';
import { ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';

interface PanZoomImageProps {
	width: number;
	height: number;
	imageUri: string;
	description: string;
	zoom: ZoomLevel;
	/** When set, the image is in locator mode: clicks on the bitmap are reported here. */
	onLocate?: (point: PlotPoint) => void;
}

/**
 * A component to pan the image and set the image zoom (scale multiplier).
 * The component is composed of the image and scrollable controls. The controls are provided
 * by the DomScrollableElement class.
 * @param props A PanZoomImageProps that contains the component properties.
 * @returns The rendered component.
 */
export const PanZoomImage = (props: PanZoomImageProps) => {
	const [naturalWidth, setNaturalWidth] = React.useState<number>(props.width);
	const [naturalHeight, setNaturalHeight] = React.useState<number>(props.height);
	const [scrollableWidth, setScrollableWidth] = React.useState<number>(props.width);
	const [scrollableHeight, setScrollableHeight] = React.useState<number>(props.height);
	const imageRef = React.useRef<HTMLImageElement>(null);

	// updates the image size and position based on the zoom level
	React.useEffect(() => {
		if (!imageRef.current) {
			return;
		}
		// scale by the zoom level
		// if the zoom level is Fill, then the image should fill the container using css
		const adjustedWidth = props.zoom === ZoomLevel.Fit ? naturalWidth : naturalWidth * props.zoom;
		const adjustedHeight = props.zoom === ZoomLevel.Fit ? naturalHeight : naturalHeight * props.zoom;

		if (props.zoom === ZoomLevel.Fit) {
			imageRef.current.style.width = '100%';
			imageRef.current.style.height = '100%';
			imageRef.current.style.objectFit = 'contain';
			setScrollableWidth(props.width);
			setScrollableHeight(props.height);
		} else {
			imageRef.current.style.width = `${adjustedWidth}px`;
			imageRef.current.style.height = `${adjustedHeight}px`;
			setScrollableWidth(adjustedWidth);
			setScrollableHeight(adjustedHeight);
		}

		imageRef.current.style.position = 'relative';
		if (adjustedWidth < props.width && adjustedHeight < props.height) {
			imageRef.current.style.top = '50%';
			imageRef.current.style.left = '50%';
			imageRef.current.style.transform = 'translate(-50%, -50%)';
		} else if (adjustedWidth < props.width) {
			imageRef.current.style.top = '0';
			imageRef.current.style.left = '50%';
			imageRef.current.style.transform = 'translate(-50%, 0)';
		} else if (adjustedHeight < props.height) {
			imageRef.current.style.top = '50%';
			imageRef.current.style.left = '0';
			imageRef.current.style.transform = 'translate(0, -50%)';
		} else {
			imageRef.current.style.top = '0';
			imageRef.current.style.left = '0';
			imageRef.current.style.transform = 'none';
		}
	}, [naturalWidth, naturalHeight, props.width, props.height, props.zoom, props.imageUri]);

	return (
		<Scrollable height={props.height} mousePan={!props.onLocate} scrollableHeight={scrollableHeight} scrollableWidth={scrollableWidth} width={props.width}>
			<img ref={imageRef}
				alt={props.description}
				className='plot'
				draggable={false}
				src={props.imageUri}
				style={props.onLocate ? { cursor: 'crosshair' } : undefined}
				onClick={props.onLocate ? e => {
					// Read the natural size from the element: the state lags behind a new image until onLoad.
					const img = e.currentTarget;
					const point = plotPointFromClick(
						img.getBoundingClientRect(),
						{ width: img.naturalWidth, height: img.naturalHeight },
						{ x: e.clientX, y: e.clientY },
						props.zoom === ZoomLevel.Fit
					);
					if (point) {
						props.onLocate?.(point);
					}
				} : undefined}
				onLoad={(el) => {
					// ensures the zoom level is applied correctly when switching images
					setNaturalWidth(el.currentTarget.naturalWidth);
					setNaturalHeight(el.currentTarget.naturalHeight);
				}}
			/>
		</Scrollable>
	);
};
