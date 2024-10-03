/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridSmoothScrollbar';

// React.
import * as React from 'react';
import { CSSProperties, MouseEvent, useLayoutEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { pinToRange } from 'vs/base/common/positronUtilities';

/**
 * Constants.
 */
const MIN_SLIDER_SIZE = 20;

/**
 * DataGridSmoothScrollbarProps interface.
 */
interface DataGridSmoothScrollbarProps {
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
	 * Gets the scroll offset. For a vertical scrollbar, this is the top position of the scrollbar.
	 * For a horizontal scrollbar, this is the left position of the scrollbar.
	 */
	readonly scrollOffset: number;

	/**
	 * Gets the maximum scroll offset. For a vertical scrollbar, this is the maximum top position of
	 * the scrollbar. For a horizontal scrollbar, this is the maximum left position of the
	 * scrollbar.
	 */
	readonly maximumScrollOffset: number;

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
	 * Gets the scrollbar length. For a vertical scrollbar, this is the scrollbar height. For a
	 * horizontal scrollbar, this is the scrollbar width.
	 */
	readonly scrollbarLength: number;

	/**
	 * Gets a value which indicates whether the scrollbar is disabled.
	 */
	readonly scrollbarDisabled: boolean;

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

	/**
	 * Gets a value which indicates whether to preserve slider position. This is set to true when
	 * the user has directly positioned the scrollbar before the onDidChangeScrollOffset callback is
	 * called.
	 */
	readonly preserveSliderPosition: boolean;
}

/**
 * DataGridSmoothScrollbar component.
 * @param props A DataGridSmoothScrollbarProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridSmoothScrollbar = (props: DataGridSmoothScrollbarProps) => {
	// State hooks.
	const [state, setState] = useState<ScrollbarState>({
		scrollbarLength: 0,
		scrollbarDisabled: true,
		sliderSize: 0,
		sliderPosition: 0,
		preserveSliderPosition: false
	});

	/**
	 * Main useEffect.
	 */
	useLayoutEffect(() => {
		// Update the scrollbar state.
		setState(previousScrollbarState => {
			// Calculate the scrollbar length.
			let scrollbarLength = props.orientation === 'vertical' ?
				props.containerHeight :
				props.containerWidth;
			if (props.bothScrollbarsVisible) {
				scrollbarLength -= props.scrollbarThickness;
			}

			// If the scrollbar isn't necessary, disable it and return.
			if (props.scrollOffset === 0 && scrollbarLength >= props.scrollSize) {
				return {
					scrollbarLength,
					scrollbarDisabled: true,
					sliderSize: 0,
					sliderPosition: 0,
					preserveSliderPosition: false
				};
			}

			// Calculate the slider size.
			const sliderSize = Math.max(
				scrollbarLength / props.scrollSize * props.layoutSize,
				MIN_SLIDER_SIZE
			);

			// Calculate the slider position.
			let sliderPosition: number;
			if (previousScrollbarState.preserveSliderPosition) {
				console.log('preserve slider position!');
				sliderPosition = state.sliderPosition;
			} else {
				console.log('change slider position!');
				sliderPosition =
					props.scrollOffset / props.maximumScrollOffset *
					(scrollbarLength - sliderSize);
			}

			// console.log(`Outside slider position: ${sliderPosition}`);

			// Update the scrollbar state.
			return {
				scrollbarLength,
				scrollbarDisabled: false,
				sliderSize,
				sliderPosition,
				preserveSliderPosition: false
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

		// Calculate the slider position so that it is centered on the mouse position in the
		// scrollbar.
		const sliderPosition = pinToRange(
			mousePosition - (state.sliderSize / 2),
			0,
			state.scrollbarLength - state.sliderSize
		);

		// Set the scrollbar state.
		setState(previousScrollbarState => {
			return {
				...previousScrollbarState,
				sliderPosition,
				preserveSliderPosition: true
			};
		});

		// Calculate the scroll offset.
		const scrollOffset = Math.min(Math.trunc(
			(props.scrollSize - 10) * sliderPosition / (state.scrollbarLength - state.sliderSize)),
			1000
		);

		// Call the onDidChangeScrollOffset callback.
		props.onDidChangeScrollOffset(scrollOffset);
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
			setState(previousScrollbarState => {
				return {
					...previousScrollbarState,
					sliderPosition,
					preserveSliderPosition: true
				};
			});

			console.log(`Slider position: ${sliderPosition}`);

			const sliderPercent = pinToRange(
				sliderPosition / (state.scrollbarLength - state.sliderSize),
				0,
				1
			);

			console.log(`sliderPercent: ${sliderPercent}`);

			// Call the onDidChangeScrollOffset callback.
			props.onDidChangeScrollOffset(props.maximumScrollOffset * sliderPercent);
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
			className={`data-grid-smooth-scrollbar ${props.orientation}`}
			style={scrollbarStyle}
			onMouseDown={mouseDownHandler}
		>
			<div
				className={`data-grid-smooth-scrollbar-slider ${props.orientation}`}
				style={sliderStyle}
				onPointerDown={pointerDownHandler}
			/>
		</div>
	);
};
