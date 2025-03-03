/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './verticalSplitter.css';

// React.
import React, { PointerEvent, useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../dom.js';
import { Delayer } from '../../../../common/async.js';
import { isMacintosh } from '../../../../common/platform.js';
import { DisposableStore } from '../../../../common/lifecycle.js';
import { useStateRef } from '../../react/useStateRef.js';
import { positronClassNames } from '../../../../common/positronUtilities.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { Button, KeyboardModifiers, MouseTrigger } from '../button/button.js';
import { createStyleSheet } from '../../../domStylesheets.js';

/**
 * Constants.
 */
const EXPAND_COLLAPSE_BUTTON_TOP = 4;
const EXPAND_COLLAPSE_BUTTON_SIZE = 25;

/**
 * VerticalSplitterBaseProps type.
 */
type VerticalSplitterBaseProps = | {
	readonly configurationService: IConfigurationService;
	readonly invert?: boolean;
	readonly showSash?: boolean;
	readonly onBeginResize: () => VerticalSplitterResizeParams;
	readonly onResize: (width: number) => void;
};

/**
 * VerticalSplitterCollapseProps type.
 */
type VerticalSplitterCollapseProps = | {
	readonly collapsible?: false;
	readonly isCollapsed?: never;
	readonly onCollapsedChanged?: never;
} | {
	readonly collapsible: true;
	readonly isCollapsed: boolean;
	readonly onCollapsedChanged: (collapsed: boolean) => void;
};

/**
 * VerticalSplitterProps type.
 */
type VerticalSplitterProps = VerticalSplitterBaseProps & VerticalSplitterCollapseProps;

/**
 * VerticalSplitterResizeParams interface. This defines the parameters of a resize operation.
 */
export interface VerticalSplitterResizeParams {
	readonly minimumWidth: number;
	readonly maximumWidth: number;
	readonly startingWidth: number;
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
 * Determines whether a point is inside an element.
 * @param x The X coordinate.
 * @param y The Y coordinate.
 * @param element The element.
 * @returns true, if the point is inside the specified element; otherwise, false.
 */
const isPointInsideElement = (x: number, y: number, element?: HTMLElement) => {
	if (!element) {
		return false;
	}

	const rect = element.getBoundingClientRect();
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

/**
 * Calculates the splitter width.
 * @param configurationService The configuration service.
 * @param collapsible A value which indicates whether the splitter is collapsible.
 * @returns The splitter width.
 */
const calculateSplitterWidth = (
	configurationService: IConfigurationService,
	collapsible?: boolean
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
	invert,
	showSash,
	collapsible,
	isCollapsed,
	onCollapsedChanged,
	onBeginResize,
	onResize,
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
	const [sashIndicatorWidth, setSashIndicatorWidth] = useState(getSashSize(configurationService));
	const [hoverDelay, setHoverDelay] = useState(getHoverDelay(configurationService));
	const [hovering, setHovering] = useState(false);
	const [highlightExpandCollapse, setHighlightExpandCollapse] = useState(false);
	const [hoveringDelayer, setHoveringDelayer] = useState<Delayer<void>>(undefined!);
	const [collapsed, setCollapsed, collapsedRef] = useStateRef(isCollapsed);
	const [resizing, setResizing] = useState(false);

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
						setSplitterWidth(calculateSplitterWidth(configurationService, collapsible));
						setSashWidth(calculateSashWidth(configurationService, collapsible));
						setSashIndicatorWidth(getSashSize(configurationService));
					}

					// Track changes to workbench.sash.hoverDelay.
					if (configurationChangeEvent.affectedKeys.has('workbench.sash.hoverDelay')) {
						setHoverDelay(getHoverDelay(configurationService));
					}
				}
			})
		);

		// Set the hover delayer.
		setHoveringDelayer(disposableStore.add(new Delayer<void>(0)));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [collapsible, configurationService]);

	// Collapsed useEffect.
	useEffect(() => {
		setCollapsed(isCollapsed);
	}, [isCollapsed, setCollapsed]);

	/**
	 * Sash onPointerEnter handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerEnterHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		hoveringDelayer.trigger(() => {
			setHovering(true);
			const rect = sashRef.current.getBoundingClientRect();
			if (e.clientY >= rect.top + EXPAND_COLLAPSE_BUTTON_TOP &&
				e.clientY <= rect.top + EXPAND_COLLAPSE_BUTTON_TOP + EXPAND_COLLAPSE_BUTTON_SIZE) {
				setHighlightExpandCollapse(true);
			}
		}, hoverDelay);
	};

	/**
	 * Sash onPointerLeave handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerLeaveHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		// When not resizing, trigger the delayer.
		if (!resizing) {
			hoveringDelayer.trigger(() => setHovering(false), hoverDelay);
		}
	};

	/**
	 * Expand / collapse button onPointerEnter handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const expandCollapseButtonPointerEnterHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		hoveringDelayer.cancel();
		setHovering(true);
		setHighlightExpandCollapse(true);
	};

	/**
	 * Expand / collapse button onPointerLeave handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const expandCollapseButtonPointerLeaveHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		hoveringDelayer.trigger(() => setHovering(false), hoverDelay);
		setHighlightExpandCollapse(false);
	};

	/**
	 * onPressed handler.
	 * @param e The keyboard modifiers.
	 */
	const expandCollapseButtonPressedHandler = (e: KeyboardModifiers) => {
		if (!collapsed) {
			setCollapsed(true);
			onCollapsedChanged?.(true);
		} else {
			setCollapsed(false);
			onCollapsedChanged?.(false);
		}

		hoveringDelayer.cancel();
		setHovering(false);
		setHighlightExpandCollapse(false);
	};

	/**
	 * pointerDown handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		// Ignore events we don't process.
		const isNonLeftMouseClick = e.pointerType === 'mouse' && e.buttons !== 1;
		if (isNonLeftMouseClick) {
			return;
		}

		// Determine whether the event occurred inside the expand / collapse button. If it did,
		// don't process the event.
		if (isPointInsideElement(e.clientX, e.clientY, expandCollapseButtonRef.current)) {
			return;
		}

		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Setup the resize state.
		const resizeParams = onBeginResize();
		const startingWidth = collapsed ? sashWidth : resizeParams.startingWidth;
		const target = DOM.getWindow(e.currentTarget).document.body;
		const clientX = e.clientX;
		const styleSheet = createStyleSheet(target);

		/**
		 * pointermove event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const pointerMoveHandler = (e: PointerEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Calculate the delta.
			const delta = Math.trunc(e.clientX - clientX);

			// Calculate the new width.
			let newWidth = !invert ?
				startingWidth + delta :
				startingWidth - delta;

			// Adjust the new width to be within limits and set cursor and collapsed state accordingly
			let newCollapsed = false;
			let cursor: string | undefined = undefined;
			if (newWidth < resizeParams.minimumWidth / 2) {
				newWidth = resizeParams.minimumWidth;
				newCollapsed = true;
				cursor = isMacintosh ? 'col-resize' : 'ew-resize';
			} else if (newWidth < resizeParams.minimumWidth) {
				newWidth = resizeParams.minimumWidth;
				newCollapsed = false;
				cursor = !invert ? 'e-resize' : 'w-resize';
			} else if (newWidth > resizeParams.maximumWidth) {
				newWidth = resizeParams.maximumWidth;
				newCollapsed = false;
				cursor = !invert ? 'w-resize' : 'e-resize';
			} else {
				newCollapsed = false;
				cursor = isMacintosh ? 'col-resize' : 'ew-resize';
			}

			// Set the cursor.
			if (cursor) {
				styleSheet.textContent = `* { cursor: ${cursor} !important; }`;
			}

			// Perform the resize
			onResize(newWidth);

			// Set the collapsed state.
			if (newCollapsed !== collapsedRef.current) {
				setCollapsed(newCollapsed);
				onCollapsedChanged?.(newCollapsed);
			}
		};

		/**
		 * lostpointercapture event handler
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const lostPointerCaptureHandler = (e: PointerEvent) => {
			// Handle the last possible move change.
			pointerMoveHandler(e);

			// Remove our pointer event handlers.
			// @ts-ignore
			target.removeEventListener('pointermove', pointerMoveHandler);
			// @ts-ignore
			target.removeEventListener('lostpointercapture', lostPointerCaptureHandler);

			// Remove the style sheet.
			target.removeChild(styleSheet);

			// Clear the resizing flag.
			setResizing(false);
			hoveringDelayer.cancel();
			setHovering(isPointInsideElement(e.clientX, e.clientY, sashRef.current));
		};

		// Set the dragging flag
		setResizing(true);

		// Set the capture target of future pointer events to be the current target and add our
		// pointer event handlers.
		target.setPointerCapture(e.pointerId);
		// @ts-ignore
		target.addEventListener('pointermove', pointerMoveHandler);
		// @ts-ignore
		target.addEventListener('lostpointercapture', lostPointerCaptureHandler);
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
				className='sash'
				style={{
					left: collapsible ? -1 : -(sashWidth / 2),
					width: collapsible ? sashWidth + 2 : sashWidth
				}}
				onPointerDown={sashPointerDownHandler}
				onPointerEnter={sashPointerEnterHandler}
				onPointerLeave={sashPointerLeaveHandler}
			>
				{showSash && (hovering || resizing) &&
					<div
						className={positronClassNames(
							'sash-indicator',
							{ 'hovering': showSash && hovering },
							{ 'resizing': showSash && resizing },
						)}
						style={{
							width: sashIndicatorWidth,
						}}
					/>
				}
			</div>
			{collapsible && (hovering || resizing || collapsed) &&
				<Button
					ref={expandCollapseButtonRef}
					className='expand-collapse-button'
					mouseTrigger={MouseTrigger.MouseDown}
					style={{
						top: EXPAND_COLLAPSE_BUTTON_TOP,
						width: EXPAND_COLLAPSE_BUTTON_SIZE,
						height: EXPAND_COLLAPSE_BUTTON_SIZE
					}}
					onPressed={expandCollapseButtonPressedHandler}
				>
					<div
						className={positronClassNames(
							'expand-collapse-button-face',
							'codicon',
							!collapsed ?
								!invert ? 'codicon-chevron-left' : 'codicon-chevron-right' :
								!invert ? 'codicon-chevron-right' : 'codicon-chevron-left',
							{ highlighted: highlightExpandCollapse }
						)}
						style={{
							width: EXPAND_COLLAPSE_BUTTON_SIZE,
							height: EXPAND_COLLAPSE_BUTTON_SIZE
						}}
						onPointerEnter={expandCollapseButtonPointerEnterHandler}
						onPointerLeave={expandCollapseButtonPointerLeaveHandler}
					/>
				</Button>
			}
		</div>
	);
};
