/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridScrollbar.css';

// React.
import React, { CSSProperties, MouseEvent, useLayoutEffect, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { pinToRange } from '../../../../base/common/positronUtilities.js';

/**
 * Constants.
 */
const MIN_SLIDER_SIZE = 20;

/**
 * DataGridScrollbarProps interface.
 */
interface DataGridScrollbarProps {
	/**
	 * Gets the container width for the scrollbar.
	 */
	readonly containerWidth: number;

	/**
	 * Gets the container height for the scrollbar.
	 */
	readonly containerHeight: number;

	/**
	 * Gets the orientation of the scrollbar.
	 */
	readonly orientation: 'horizontal' | 'vertical';

	/**
	 * Gets a value which indicates whether both horizontal and vertical scrollbars are visible.
	 */
	readonly bothScrollbarsVisible: boolean;

	/**
	 * Gets the scrollbar thickness. For a vertical scrollbar, this is the scrollbar width. For a
	 * horizontal scrollbar, this is the scrollbar height.
	 */
	readonly scrollbarThickness: number;

	/**
	 * Gets the scroll size. For a vertical scrollbar, this is the height of the scrollable
	 * content. For a horizontal scrollbar, this is the width of the scrollable content.
	 */
	readonly scrollSize: number;

	/**
	 * Gets the layout size. For a vertical scrollbar, this is the visible height of the content.
	 * For a horizontal scrollbar, this is the visible width of the content.
	 */
	readonly layoutSize: number;

	/**
	 * Gets the page size. For a vertical scrollbar, this is the height of a page. For a horizontal
	 * scrollbar, this is the width of a page.
	 */
	readonly pageSize: number;

	/**
	 * Gets the scroll offset. For a vertical scrollbar, this is the top position of the scrollbar.
	 * For a horizontal scrollbar, this is the left position of the scrollbar.
	 */
	readonly scrollOffset: number;

	/**
	 * Gets the maximum scroll offset. For a vertical scrollbar, this is the maximum top position of
	 * the scrollbar. For a horizontal scrollbar, this is the maximum left position of the
	 * scrollbar.
	 */
	readonly maximumScrollOffset: () => number;

	/**
	 * Scroll offset changed callback.
	 * @param scrollOffset The scroll offset.
	 */
	readonly onDidChangeScrollOffset: (scrollOffset: number) => void;
}

/**
 * ScrollbarState interface.
 */
interface ScrollbarState {
	/**
	 * Gets a value which indicates whether the scrollbar is disabled.
	 */
	readonly scrollbarDisabled: boolean;

	/**
	 * Gets the scrollbar length. For a vertical scrollbar, this is the scrollbar height. For a
	 * horizontal scrollbar, this is the scrollbar width.
	 */
	readonly scrollbarLength: number;

	/**
	 * Gets the slider size. For a vertical scrollbar, this is the slider height. For a horizontal
	 * scrollbar, this is the slider width.
	 */
	readonly sliderSize: number;

	/**
	 * Gets the slider position. For a vertical scrollbar, this is the top position of the slider.
	 * For a horizontal scrollbar, this is the left position of the slider.
	 */
	readonly sliderPosition: number;
}

/**
 * DataGridScrollbar component.
 * @param props A DataGridScrollbarProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridScrollbar = (props: DataGridScrollbarProps) => {
	// State hooks.
	const [state, setState] = useState<ScrollbarState>({
		scrollbarDisabled: true,
		scrollbarLength: 0,
		sliderSize: 0,
		sliderPosition: 0
	});

	/**
	 * Main useEffect.
	 */
	useLayoutEffect(() => {
		// Update the scrollbar state.
		setState((): ScrollbarState => {
			// Calculate the scrollbar length.
			let scrollbarLength = props.orientation === 'vertical' ?
				props.containerHeight :
				props.containerWidth;
			if (props.bothScrollbarsVisible) {
				scrollbarLength -= props.scrollbarThickness;
			}

			// If the scrollbar isn't necessary, disable it and return.
			if (props.scrollOffset === 0 && props.maximumScrollOffset() === 0) {
				return {
					scrollbarDisabled: true,
					scrollbarLength,
					sliderSize: 0,
					sliderPosition: 0
				};
			}

			// Calculate the slider size.
			const sliderSize = Math.max(
				scrollbarLength / props.scrollSize * props.layoutSize,
				MIN_SLIDER_SIZE
			);

			// Calculate the slider position.
			const sliderPosition =
				props.scrollOffset / props.maximumScrollOffset() *
				(scrollbarLength - sliderSize);

			// Update the scrollbar state.
			return {
				scrollbarDisabled: false,
				scrollbarLength,
				sliderSize,
				sliderPosition
			};
		});
	}, [props, state.sliderPosition]);

	/**
	 * onMouseDown handler. This handles onMouseDown in the scrollbar (i.e. not in the slider).
	 * @param e A MouseEvent that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLDivElement>) => {
		// If the scrollbar is disabled, return.
		if (state.scrollbarDisabled) {
			return;
		}

		// Get the bounding client rect.
		const boundingClientRect = e.currentTarget.getBoundingClientRect();

		// Calculate the mouse position in the scrollbar.
		const mousePosition = props.orientation === 'vertical' ?
			e.clientY - boundingClientRect.y :
			e.clientX - boundingClientRect.x;

		// If the mouse is above the slider, page up. If the mouse is below the slider, page down.
		if (mousePosition < state.sliderPosition) {
			props.onDidChangeScrollOffset(
				Math.max(props.scrollOffset - props.pageSize, 0)
			);
		} else if (mousePosition > state.sliderPosition + state.sliderSize) {
			props.onDidChangeScrollOffset(
				Math.min(props.scrollOffset + props.pageSize, props.maximumScrollOffset())
			);
		}
	};

	/**
	 * onPointerDown handler. This handles onPointerDown in the slider and is how the user can drag
	 * the slider around to scroll.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const pointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		// If the scrollbar is disabled, return.
		if (state.scrollbarDisabled) {
			return;
		}

		// Ignore events we don't process.
		if (e.pointerType === 'mouse' && e.buttons !== 1) {
			return;
		}

		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Setup the drag state.
		const target = DOM.getWindow(e.currentTarget).document.body;
		const startingSliderPosition = state.sliderPosition;
		const startingMousePosition = props.orientation === 'vertical' ? e.clientY : e.clientX;

		/**
		 * pointermove event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const pointerMoveHandler = (e: PointerEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Adjust the slider.
			updateSliderPosition(e);
		};

		/**
		 * lostpointercapture event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const lostPointerCaptureHandler = (e: PointerEvent) => {
			// Remove our pointer event handlers.
			target.removeEventListener('pointermove', pointerMoveHandler);
			target.removeEventListener('lostpointercapture', lostPointerCaptureHandler);

			// Adjust the slider.
			updateSliderPosition(e);
		};

		/**
		 * Adjusts the slider based on a pointer event.
		 * @param e The pointer event.
		 */
		const updateSliderPosition = (e: PointerEvent) => {
			// Set the slider delta.
			const sliderDelta = props.orientation === 'vertical' ? e.clientY : e.clientX;

			// Calculate the slider position.
			const sliderPosition = pinToRange(
				startingSliderPosition + sliderDelta - startingMousePosition,
				0,
				state.scrollbarLength - state.sliderSize
			);

			// Set the scrollbar state.
			setState((previousScrollbarState): ScrollbarState => {
				return {
					...previousScrollbarState,
					sliderPosition
				};
			});

			// Calculate the slider percent.
			const sliderPercent = pinToRange(
				sliderPosition / (state.scrollbarLength - state.sliderSize),
				0,
				1
			);

			// Call the onDidChangeScrollOffset callback.
			props.onDidChangeScrollOffset(props.maximumScrollOffset() * sliderPercent);
		};

		// Set the capture target of future pointer events to be the current target and add our
		// pointer event handlers.
		target.setPointerCapture(e.pointerId);
		target.addEventListener('pointermove', pointerMoveHandler);
		target.addEventListener('lostpointercapture', lostPointerCaptureHandler);
	};

	// Set the scrollbar style.
	const scrollbarStyle: CSSProperties = props.orientation === 'vertical' ? {
		width: props.scrollbarThickness,
		bottom: props.bothScrollbarsVisible ? props.scrollbarThickness : 0,
	} : {
		height: props.scrollbarThickness,
		right: props.bothScrollbarsVisible ? props.scrollbarThickness : 0
	};

	// Set the slider style.
	const sliderStyle: CSSProperties = props.orientation === 'vertical' ? {
		top: state.sliderPosition,
		// -1 to not overlap border.
		width: props.scrollbarThickness - 1,
		height: state.sliderSize
	} : {
		left: state.sliderPosition,
		width: state.sliderSize,
		// -1 to not overlap border.
		height: props.scrollbarThickness - 1
	};

	// Render.
	return (
		<div
			className={`data-grid-scrollbar ${props.orientation}`}
			style={scrollbarStyle}
			onMouseDown={mouseDownHandler}
		>
			<div
				className={`data-grid-scrollbar-slider ${props.orientation}`}
				style={sliderStyle}
				onPointerDown={pointerDownHandler}
			/>
		</div>
	);
};
