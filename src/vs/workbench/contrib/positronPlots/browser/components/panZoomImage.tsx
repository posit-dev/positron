/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
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
	const [width, setWidth] = React.useState<number>(1);
	const [height, setHeight] = React.useState<number>(1);
	const imageWrapperRef = React.useRef<HTMLDivElement>(null);
	const imageRef = React.useRef<HTMLImageElement>(null);
	const [grabbing, setGrabbing] = React.useState<boolean>(false);
	const [scrollableElement, setScrollableElement] = React.useState<DomScrollableElement>();

	// updates the scrollable element when the image size changes
	React.useEffect(() => {
		if (!scrollableElement || !imageRef.current) {
			return;
		}
		const adjustedWidth = props.zoom === ZoomLevel.Fill ? width : width * props.zoom;
		const adjustedHeight = props.zoom === ZoomLevel.Fill ? height : height * props.zoom;
		if (props.zoom === ZoomLevel.Fill) {
			scrollableElement.updateOptions({
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Hidden,
			});
			imageRef.current.style.width = '100%';
			imageRef.current.style.height = '100%';
			imageRef.current.style.objectFit = 'contain';
		} else {
			scrollableElement.updateOptions({
				horizontal: ScrollbarVisibility.Visible,
				vertical: ScrollbarVisibility.Visible,
			});
			imageRef.current.style.width = `${adjustedWidth}px`;
			imageRef.current.style.height = `${adjustedHeight}px`;
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
		scrollableElement.scanDomNode();
	}, [width, height, props.zoom, props.width, props.height, scrollableElement]);

	// Wrap the image in a scrollable element
	React.useEffect(() => {
		if (!imageWrapperRef.current || !imageRef.current) {
			return;
		}

		// only create the scrollable element once
		if (!scrollableElement) {
			/* The imageArea should contain the scrollable element and the imageWrapperRef contains all
			 * of the scrollable content. The DOM will look liks this:
			 * <div class="image-area">
			 *  <div class="positron-scrollable-element">
			 *    <div class="image-wrapper">
			 *      <img src="..." alt="..." />
			 *    </div>
			 *  </div>
			 * </div>
			 *
			 */
			const imageArea = imageWrapperRef.current.parentElement;
			const domScrollableElement = new DomScrollableElement(imageWrapperRef.current, {
				horizontal: ScrollbarVisibility.Visible,
				vertical: ScrollbarVisibility.Visible,
				useShadows: false,
				className: 'positron-scrollable-element',
			});
			setScrollableElement(domScrollableElement);
			imageArea?.appendChild(domScrollableElement.getDomNode());
		}
		return () => scrollableElement?.dispose();
	}, [imageWrapperRef, scrollableElement]);

	const onImgLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
		const img = event.target as HTMLImageElement;
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		setWidth(width);
		setHeight(height);
	};

	const panImage = (event: React.MouseEvent<HTMLElement>) => {
		if (!scrollableElement || event.buttons !== 1) {
			return;
		}

		const position = scrollableElement.getScrollPosition();

		scrollableElement.setScrollPosition(
			{
				scrollLeft: position.scrollLeft - event.movementX,
				scrollTop: position.scrollTop - event.movementY,
			},
		);
	};

	const updateCursor = (event: React.MouseEvent<HTMLElement>) => {
		setGrabbing(event.type === 'mousedown');
	};

	// Renders the image-wrapper div that contains the image element but this is
	// wrapped in a scrollable element to allow panning. See useEffect hook above.
	return (
		<div className='image-wrapper'
			ref={imageWrapperRef}
			onMouseMoveCapture={panImage}
			onMouseDown={updateCursor}
			onMouseUp={updateCursor}
			style={{ width: props.width, height: props.height }}
		>
			<img src={props.imageUri}
				alt={props.description}
				onLoad={onImgLoad}
				className={grabbing ? 'grabbing' : 'grab'}
				draggable={false}
				ref={imageRef}
			/>
		</div>
	);
};
