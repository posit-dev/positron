/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren } from 'react';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollableElementChangeOptions } from 'vs/base/browser/ui/scrollbar/scrollableElementOptions';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';

interface ScrollableProps {
	width: number;
	height: number;
	scrollableWidth: number;
	scrollableHeight: number;
	mousePan?: boolean;
}

/**
 * A scrollable component that wraps child elements and provides scrolling functionality.
 * The component is composed of the child elements and scrollable controls. The controls are provided
 * by the DomScrollableElement class.
 *
 * Any number of child elements can be wrapped by the Scrollable component. The scrollableWidth and
 * scrollableHeight properties are used to determine the scrollable extents.
 *
 * @param props Scrollable props
 * @returns The rendered component that scrolls the child element.
 */
export const Scrollable = (props: PropsWithChildren<ScrollableProps>) => {
	const [scrollableElement, setScrollableElement] = React.useState<DomScrollableElement>();
	const [grabbing, setGrabbing] = React.useState<boolean>(false);
	const scrollableRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const scrollableOptions: ScrollableElementChangeOptions = {
			horizontal: props.width < props.scrollableWidth ? ScrollbarVisibility.Visible : ScrollbarVisibility.Hidden,
			vertical: props.height < props.scrollableHeight ? ScrollbarVisibility.Visible : ScrollbarVisibility.Hidden,
		};
		scrollableRef?.current?.style.setProperty('width', `${props.width}px`);
		scrollableRef?.current?.style.setProperty('height', `${props.height}px`);
		scrollableElement?.updateOptions(scrollableOptions);
		scrollableElement?.scanDomNode();
	}, [props.children, props.width, props.height, props.scrollableWidth, props.scrollableHeight, scrollableElement]);

	/**
	 * The scrollable is appended to the parent of the wrapper element. Then the wrapper element is appended to the scrollable.
	 *
	 * The DOM will look liks this:
	 * <div class="parent">
	 *  <div class="positron-scrollable-element">
	 *    <div class="scrollable">
	 * 		<div class="scrollbar horizontal">
	 * 		<div class="scrollbar vertical">
	 *    </div>
	 *  </div>
	 * </div>
	 */
	React.useEffect(() => {
		if (!scrollableRef.current) {
			return;
		}
		if (!scrollableElement) {
			const parentElement = scrollableRef.current.parentElement;
			const scrollable = new DomScrollableElement(scrollableRef.current, {
				horizontal: ScrollbarVisibility.Auto,
				vertical: ScrollbarVisibility.Auto,
				useShadows: false,
				className: 'positron-scrollable-element',
			});

			setScrollableElement(scrollable);
			parentElement?.appendChild(scrollable.getDomNode());
			scrollable.scanDomNode();
		}
		return () => scrollableElement?.dispose();
	}, [scrollableElement]);

	React.useEffect(() => {
		// need to remove overflow hidden if the content height fits perfectly
		// otherwise, it still scrolls a pixel despite all the content being visible
		if (props.scrollableHeight === props.height) {
			scrollableRef.current?.style.removeProperty('overflow');
		} else {
			scrollableRef.current?.style.setProperty('overflow', 'hidden');
		}
	}, [props.height, props.scrollableHeight, scrollableElement]);

	const updateCursor = (event: React.MouseEvent<HTMLElement>) => {
		if (props.mousePan) {
			if (event.type === 'mousedown' && event.buttons === 1) {
				setGrabbing(true);
			} else {
				setGrabbing(false);
			}
		}
	};

	const panImage = (event: React.MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		if (props.mousePan && event.buttons === 1) {
			scrollableElement?.setScrollPosition({
				scrollLeft: scrollableElement.getScrollPosition().scrollLeft - event.movementX,
				scrollTop: scrollableElement.getScrollPosition().scrollTop - event.movementY,
			});
		}
	};

	return (
		<div className={positronClassNames('scrollable', { 'grab': !grabbing, 'grabbing': grabbing })} ref={scrollableRef} onMouseMoveCapture={panImage} onMouseDown={updateCursor} onMouseUp={updateCursor}>
			{props.children}
		</div >
	);
};
