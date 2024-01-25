/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridScrollbar';

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
 * DataGridScrollbarProps interface.
 */
interface DataGridScrollbarProps {
	/**
	 * Gets the orientation of the scrollbar.
	 */
	readonly orientation: 'vertical' | 'horizontal';

	/**
	 * Gets the scrollbar width. For a vertical scrollbar, this is the horizontal width. For a
	 * horizontal scrollbar, this is the vertical height.
	 */
	readonly scrollbarWidth: number;

	/**
	 * The container width for the scrollbar.
	 */
	containerWidth: number;

	/**
	 * The container height for the scrollbar.
	 */
	containerHeight: number;

	/**
	 * Gets the number of entries being scrolled.
	 */
	readonly entries: number;

	/**
	 * Gets the number of visible entries.
	 */
	readonly visibleEntries: number;

	/**
	 * Gets the first entry.
	 */
	readonly firstEntry: number;

	/**
	 * First entry changed callback.
	 * @param firstEntry The first entry.
	 */
	readonly onDidChangeFirstEntry: (firstEntry: number) => void;
}

/**
 * ScrollbarState interface.
 */
interface ScrollbarState {
	/**
	 * Gets the scrollbar size. For a vertical scrollbar, this is the scrollbar height. For a
	 * horizontal scrollbar, this is the scrollbar width.
	 */
	readonly scrollbarSize: number;

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
	 * the user has directly positioned the scrollbar before the onDidChangeFirstEntry callback is
	 * called.
	 */
	readonly preserveSliderPosition: boolean;
}

/**
 * DataGridScrollbar component.
 * @param props A DataGridScrollbarProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridScrollbar = (props: DataGridScrollbarProps) => {
	// State hooks.
	const [scrollbarState, setScrollbarState] = useState<ScrollbarState>({
		scrollbarSize: 0,
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
		setScrollbarState(previousScrollbarState => {
			// Calculate the scrollbar size.
			const scrollbarSize = props.orientation === 'vertical' ?
				props.containerHeight - props.scrollbarWidth :
				props.containerWidth - props.scrollbarWidth;

			// If the scrollbar isn't necessary, return.
			if (props.visibleEntries >= props.entries && props.firstEntry === 0) {
				return {
					scrollbarSize,
					scrollbarDisabled: true,
					sliderSize: 0,
					sliderPosition: 0,
					preserveSliderPosition: false
				};
			}

			// Calculate the slider size.
			const sliderSize = pinToRange(
				(props.visibleEntries / props.entries) * scrollbarSize,
				MIN_SLIDER_SIZE,
				scrollbarSize
			);

			// Calculate the slider position.
			let sliderPosition: number;
			if (previousScrollbarState.preserveSliderPosition) {
				sliderPosition = scrollbarState.sliderPosition;
			} else {
				if (props.firstEntry === 0) {
					sliderPosition = 0;
				} else if (props.firstEntry + props.visibleEntries >= props.entries) {
					sliderPosition = scrollbarSize - sliderSize;
				} else {
					sliderPosition = pinToRange(
						(scrollbarSize - sliderSize) *
						(props.firstEntry / (props.entries - props.visibleEntries)),
						0,
						scrollbarSize - sliderSize
					);
				}
			}

			// Update the scrollbar state.
			return {
				scrollbarSize,
				scrollbarDisabled: false,
				sliderSize,
				sliderPosition,
				preserveSliderPosition: false
			};
		});
	}, [props]);

	/**
	 * onMouseDown handler. This handles onMouseDown in the scrollbar (i.e. not in the slider).
	 * @param e A MouseEvent that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLDivElement>) => {
		// If the scrollbar is disabled, return.
		if (scrollbarState.scrollbarDisabled) {
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
			mousePosition - (scrollbarState.sliderSize / 2),
			0,
			scrollbarState.scrollbarSize - scrollbarState.sliderSize
		);

		// Set the scrollbar state.
		setScrollbarState(previousScrollbarState => {
			return {
				...previousScrollbarState,
				sliderPosition,
				preserveSliderPosition: true
			};
		});

		// Calculate the first entry.
		const firstEntry = Math.trunc(
			(props.entries - props.visibleEntries) *
			sliderPosition /
			(scrollbarState.scrollbarSize - scrollbarState.sliderSize));

		// Change the first entry.
		props.onDidChangeFirstEntry(firstEntry);
	};

	/**
	 * onPointerDown handler. This handles onPointerDown in the slider and is how the user can drag
	 * the slider around to scroll.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const pointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		// If the scrollbar is disabled, return.
		if (scrollbarState.scrollbarDisabled) {
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
		const startingSliderPosition = scrollbarState.sliderPosition;
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
				scrollbarState.scrollbarSize - scrollbarState.sliderSize
			);

			// Set the scrollbar state.
			setScrollbarState(previousScrollbarState => {
				return {
					...previousScrollbarState,
					sliderPosition,
					preserveSliderPosition: true
				};
			});

			// Change the first entry.
			props.onDidChangeFirstEntry(Math.trunc(
				(props.entries - props.visibleEntries) *
				sliderPosition /
				(scrollbarState.scrollbarSize - scrollbarState.sliderSize))
			);
		};

		// Set the capture target of future pointer events to be the current target and add our
		// pointer event handlers.
		target.setPointerCapture(e.pointerId);
		target.addEventListener('pointermove', pointerMoveHandler);
		target.addEventListener('lostpointercapture', lostPointerCaptureHandler);
	};

	// Set the scrollbar style.
	const scrollbarStyle: CSSProperties = props.orientation === 'vertical' ? {
		width: props.scrollbarWidth,
		bottom: props.scrollbarWidth,
	} : {
		height: props.scrollbarWidth,
		right: props.scrollbarWidth
	};

	// Set the slider style.
	const sliderStyle: CSSProperties = props.orientation === 'vertical' ? {
		top: scrollbarState.sliderPosition,
		width: props.scrollbarWidth,
		height: scrollbarState.sliderSize
	} : {
		left: scrollbarState.sliderPosition,
		width: scrollbarState.sliderSize,
		height: props.scrollbarWidth
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
