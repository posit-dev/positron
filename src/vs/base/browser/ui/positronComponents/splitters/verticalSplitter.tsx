/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./verticalSplitter';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { Delayer } from 'vs/base/common/async';
import { isMacintosh } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Button, KeyboardModifiers, MouseTrigger } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * VerticalSplitterBaseProps type.
 */
type VerticalSplitterBaseProps = | {
	readonly configurationService: IConfigurationService;
	readonly showSash: boolean;
	readonly onBeginResize: () => VerticalSplitterResizeParams;
	readonly onResize: (width: number) => void;
};

/**
 * VerticalSplitterCollapseProps type.
 */
type VerticalSplitterCollapseProps = | {
	readonly collapsible: false;
	readonly onCollapse?: never;
	readonly onExpand?: never;
} | {
	readonly collapsible: true;
	readonly onCollapse: () => void;
	readonly onExpand: () => void;
};

/**
 * VerticalSplitterProps type.
 */
type VerticalSplitterProps = VerticalSplitterBaseProps & VerticalSplitterCollapseProps;

/**
 * VerticalSplitterResizeParams interface. This defines the parameters of a resize operation. When
 * invert is true, the mouse delta is subtracted from the starting width instead of being added to
 * it, which inverts the resize operation.
 */
export interface VerticalSplitterResizeParams {
	minimumWidth: number;
	maximumWidth: number;
	columnsWidth: number;
	invert?: boolean;
}

/**
 * Gets the sash size.
 * @param configurationService The configuration service.
 * @returns The sash size.
 */
const getSashSize = (configurationService: IConfigurationService) =>
	configurationService.getValue<number>('workbench.sash.size');

/**
 * Gets the hover delay.
 * @param configurationService The configuration service.
 * @returns The hover delay.
 */
const getHoverDelay = (configurationService: IConfigurationService) =>
	configurationService.getValue<number>('workbench.sash.hoverDelay');

/**
 * Determines whether a pointer event occurred inside an element.
 * @param e The pointer event.
 * @param element The element.
 * @returns true, if the pointer event occurred inside the specified element; otherwise, false.
 */
const isPointerEventInsideElement = (e: React.PointerEvent<HTMLElement>, element?: HTMLElement) => {
	if (!element) {
		return false;
	} else {
		const rect = element.getBoundingClientRect();
		return (
			e.clientX >= rect.left &&
			e.clientX <= rect.right &&
			e.clientY >= rect.top &&
			e.clientY <= rect.bottom
		);
	}
};

/**
 * Calculates the splitter width.
 * @param configurationService The configuration service.
 * @param collapsible A value which indicates whether the splitter is collapsible.
 * @returns The splitter width.
 */
const calculateSplitterWidth = (
	configurationService: IConfigurationService,
	collapsible: boolean
) => !collapsible ? 1 : getSashSize(configurationService) * 2;

/**
 * Calculates the sash width.
 * @param configurationService The configuration service.
 * @param collapsible A value which indicates whether the vertical splitter is collapsible.
 * @returns The sash width.
 */
const calculateSashWidth = (configurationService: IConfigurationService, collapsible?: boolean) => {
	// Get the sash size.
	let sashSize = getSashSize(configurationService);

	// If the vertical splitter is collapsible, double the sash size.
	if (collapsible) {
		sashSize *= 2;
	}

	// Return the sash size.
	return sashSize;
};

/**
 * VerticalSplitter component.
 * @param props A VerticalSplitterProps that contains the component properties.
 * @returns The rendered component.
 */
export const VerticalSplitter = ({
	configurationService,
	showSash,
	collapsible,
	onBeginResize,
	onResize,
	onExpand,
	onCollapse
}: VerticalSplitterProps) => {
	// Reference hooks.
	const sashRef = useRef<HTMLDivElement>(undefined!);
	const expandCollapseButtonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [splitterWidth, setSplitterWidth] = useState(
		calculateSplitterWidth(configurationService, collapsible)
	);
	const [sashWidth, setSashWidth] = useState(
		calculateSashWidth(configurationService, collapsible)
	);
	const [hoverDelay, setHoverDelay] = useState(getHoverDelay(configurationService));
	const [hovering, setHovering] = useState(false);
	const [resizing, setResizing] = useState(false);
	const [highlightExpandCollapse, setHighlightExpandCollapse] = useState(false);
	const [delayer, setDelayer] = useState<Delayer<void>>(undefined!);
	const [collapsed, setCollapsed] = useState(false);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeConfiguration event handler.
		disposableStore.add(
			configurationService.onDidChangeConfiguration(configurationChangeEvent => {
				// When workbench.sash.* changes, update state.
				if (configurationChangeEvent.affectsConfiguration('workbench.sash')) {
					// Track changes to workbench.sash.size.
					if (configurationChangeEvent.affectedKeys.has('workbench.sash.size')) {
						setSplitterWidth(
							calculateSplitterWidth(configurationService, collapsible)
						);
						setSashWidth(
							calculateSashWidth(configurationService, collapsible)
						);
					}
					// Track changes to workbench.sash.hoverDelay.
					if (configurationChangeEvent.affectedKeys.has('workbench.sash.hoverDelay')) {
						setHoverDelay(getHoverDelay(configurationService));
					}
				}
			})
		);

		// Set the hover delayer.
		setDelayer(disposableStore.add(new Delayer<void>(0)));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [collapsible, configurationService]);

	/**
	 * Sash onPointerEnter handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerEnterHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		delayer.trigger(() => {
			setHovering(true);
			const rect = sashRef.current.getBoundingClientRect();
			if (e.clientY >= rect.top + 4 && e.clientY <= rect.top + 4 + 25) {
				setHighlightExpandCollapse(true);
			}
		}, hoverDelay);
	};

	/**
	 * Sash onPointerLeave handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerLeaveHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		delayer.trigger(() => setHovering(false), hoverDelay);
	};

	/**
	 * sash onPointerDown handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		// Ignore events we don't process.
		if (e.pointerType === 'mouse' && e.buttons !== 1) {
			return;
		}

		// Determine whether the event occurred inside the expand / collapse button. If it did,
		// don't process the event.
		if (isPointerEventInsideElement(e, expandCollapseButtonRef.current)) {
			return;
		}

		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Begin resize to obtain the resize parameters.
		const { minimumWidth, maximumWidth, columnsWidth, invert } = onBeginResize();

		// Setup the resize state.
		const initiallyCollapsed = collapsed;
		const target = DOM.getWindow(e.currentTarget).document.body;
		const clientX = e.clientX;
		const styleSheet = DOM.createStyleSheet(target);
		const startingWidth = collapsed ? sashWidth : columnsWidth;

		/**
		 * pointermove event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const pointerMoveHandler = (e: PointerEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			//
			if (collapsed) {
				setCollapsed(false);
				onExpand?.();
			}

			// Calculate the new width.
			let newWidth = calculateNewWidth(e);

			// Adjust the new width to be within limits and set the cursor accordingly.
			let cursor: string;
			if (newWidth < minimumWidth) {
				// When the new width is less than 50% of the minimum width, use the w-resize cursor
				// to indicate that the splitter will collapse. Otherwise, use the e-resize cursor
				// to let the user know they've exceeded the minimum width.
				cursor = newWidth < minimumWidth / 2 && !initiallyCollapsed ? 'w-resize' : 'e-resize';
				newWidth = minimumWidth;
			} else if (newWidth > maximumWidth) {
				cursor = 'w-resize';
				newWidth = maximumWidth;
			} else {
				cursor = isMacintosh ? 'col-resize' : 'ew-resize';
			}

			// Update the style sheet's text content with the desired cursor. This is a clever
			// technique adopted from src/vs/base/browser/ui/sash/sash.ts.
			styleSheet.textContent = `* { cursor: ${cursor} !important; }`;

			// Call the onResize callback.
			onResize(newWidth);
		};

		/**
		 * lostpointercapture event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const lostPointerCaptureHandler = (e: PointerEvent) => {
			// Clear the dragging flag.
			setResizing(false);

			// Remove our pointer event handlers.
			target.removeEventListener('pointermove', pointerMoveHandler);
			target.removeEventListener('lostpointercapture', lostPointerCaptureHandler);

			// Remove the style sheet.
			target.removeChild(styleSheet);

			// Calculate the new width.
			let newWidth = calculateNewWidth(e);

			// If the new width is less than half of the minimum width, and the splitter wasn't
			// collapsed, collapse the splitter.
			if (newWidth < minimumWidth / 2 && !initiallyCollapsed) {
				setCollapsed(true);
				onCollapse?.();
				return;
			}

			// Adjust the new width.
			if (newWidth < minimumWidth) {
				newWidth = minimumWidth;
			} else if (newWidth > maximumWidth) {
				newWidth = maximumWidth;
			}

			// Call the onResize callback.
			onResize(newWidth);
		};

		/**
		 * Calculates the new width based on a GlobalPointerEvent.
		 * @param e The GlobalPointerEvent.
		 * @returns The new width.
		 */
		const calculateNewWidth = (e: PointerEvent) => {
			// Calculate the delta.
			const delta = Math.trunc(e.clientX - clientX);

			// Calculate the new width.
			return !invert ?
				startingWidth + delta :
				startingWidth - delta;
		};

		// Set the resizing flag and clear the collapsed flag.
		setResizing(true);

		// Set the capture target of future pointer events to be the current target and add our
		// pointer event handlers.
		target.setPointerCapture(e.pointerId);
		target.addEventListener('pointermove', pointerMoveHandler);
		target.addEventListener('lostpointercapture', lostPointerCaptureHandler);
	};

	/**
	 * Expand / collapse button onPointerEnter handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const expandCollapseButtonPointerEnterHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		delayer.cancel();
		setHovering(true);
		setHighlightExpandCollapse(true);
	};

	/**
	 * Expand / collapse button onPointerLeave handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const expandCollapseButtonPointerLeaveHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		delayer.trigger(() => setHovering(false), hoverDelay);
		setHighlightExpandCollapse(false);
	};

	/**
	 * onPressed handler.
	 * @param e The keyboard modifiers.
	 */
	const expandCollapseButtonPressedHandler = (e: KeyboardModifiers) => {
		if (!collapsed) {
			setCollapsed(true);
			onCollapse?.();
		} else {
			setCollapsed(false);
			onExpand?.();
		}

		delayer.cancel();
		setHovering(false);
		setHighlightExpandCollapse(false);
	};

	// Render.
	return (
		<div
			className={positronClassNames(
				'vertical-splitter',
				{ collapsible }
			)}
			style={{
				width: splitterWidth
			}}
		>
			<div
				ref={sashRef}
				className={positronClassNames(
					'sash',
					{ 'sash-hovering': showSash && hovering },
					{ 'sash-resizing': showSash && resizing },
				)}
				style={{
					left: collapsible ? -1 : -(sashWidth / 2),
					width: collapsible ? sashWidth + 2 : sashWidth
				}}
				onPointerEnter={sashPointerEnterHandler}
				onPointerLeave={sashPointerLeaveHandler}
				onPointerDown={sashPointerDownHandler}
			/>
			{collapsible && (hovering || resizing || collapsed) &&
				<Button
					ref={expandCollapseButtonRef}
					className='expand-collapse-button'
					mouseTrigger={MouseTrigger.MouseDown}
					onPressed={expandCollapseButtonPressedHandler}
				>
					<div
						className={positronClassNames(
							'expand-collapse-button-face',
							'codicon',
							collapsed ? 'codicon-chevron-right' : 'codicon-chevron-left',
							{ yack: highlightExpandCollapse }
						)}
						onPointerEnter={expandCollapseButtonPointerEnterHandler}
						onPointerLeave={expandCollapseButtonPointerLeaveHandler}
					/>
				</Button>
			}
		</div>
	);
};
