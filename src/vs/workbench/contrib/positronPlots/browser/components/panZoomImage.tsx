/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { Scrollable } from 'vs/base/browser/ui/positronComponents/scrollable/Scrollable';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';

interface PanZoomImageProps {
	width: number;
	height: number;
	imageUri: string;
	description: string;
	zoom: ZoomLevel;
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
		const adjustedWidth = props.zoom === ZoomLevel.Fill ? naturalWidth : naturalWidth * props.zoom;
		const adjustedHeight = props.zoom === ZoomLevel.Fill ? naturalHeight : naturalHeight * props.zoom;

		if (props.zoom === ZoomLevel.Fill) {
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
		<Scrollable width={props.width} height={props.height} scrollableWidth={scrollableWidth} scrollableHeight={scrollableHeight} mousePan={true}>
			<img src={props.imageUri}
				alt={props.description}
				draggable={false}
				ref={imageRef}
				onLoad={(el) => {
					// ensures the zoom level is applied correctly when switching images
					setNaturalWidth(el.currentTarget.naturalWidth);
					setNaturalHeight(el.currentTarget.naturalHeight);
				}}
			/>
		</Scrollable>
	);
};
