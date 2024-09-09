/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./verticalSplitter';

// React.
import * as React from 'react';
import { PointerEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { Delayer } from 'vs/base/common/async';
import { isMacintosh } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Button, KeyboardModifiers, MouseTrigger } from 'vs/base/browser/ui/positronComponents/button/button';

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
	readonly onCollapsedChanged?: never;
} | {
	readonly collapsible: true;
	readonly onCollapsedChanged: (collapsed: boolean) => void;
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
	readonly minimumWidth: number;
	readonly maximumWidth: number;
	readonly columnsWidth: number;
}

/**
 * ResizeParams interface. Represents a resize that's in progress.
 */
interface ResizeParams {
	readonly minimumWidth: number;
	readonly maximumWidth: number;
	readonly startingWidth: number;
	readonly clientX: number;
	readonly styleSheet: HTMLStyleElement;
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
	const [collapsed, setCollapsed] = useState(false);
	const [resizeParams, setResizeParams] = useState<ResizeParams | undefined>(undefined);

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

	/**
	 * Sash onPointerEnter handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerEnterHandler = (e: PointerEvent<HTMLDivElement>) => {
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
	const sashPointerLeaveHandler = (e: PointerEvent<HTMLDivElement>) => {
		// When not resizing, trigger the delayer.
		if (!resizeParams) {
			hoveringDelayer.trigger(() => setHovering(false), hoverDelay);
		}
	};

	/**
	 * Sash onPointerDown handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerDownHandler = (e: PointerEvent<HTMLDivElement>) => {
		// Ignore events we don't process.
		if (e.pointerType === 'mouse' && e.buttons !== 1) {
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

		// Begin resize to obtain the resize parameters.
		const { minimumWidth, maximumWidth, columnsWidth } = onBeginResize();

		// Set the resize params.
		setResizeParams({
			minimumWidth,
			maximumWidth,
			startingWidth: collapsed ? sashWidth : columnsWidth,
			clientX: e.clientX,
			styleSheet: DOM.createStyleSheet(sashRef.current)
		});

		// Set pointer capture.
		sashRef.current.setPointerCapture(e.pointerId);
	};

	/**
	 * Sash onPointerDown handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const sashPointerEventHandler = (e: PointerEvent<HTMLDivElement>) => {
		// Ignore events we do not process.
		if (!resizeParams) {
			return;
		}

		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Determine whether to end the resize operation.
		const endResize = e.type === 'lostpointercapture';

		// Calculate the delta.
		const delta = Math.trunc(e.clientX - resizeParams.clientX);

		// Calculate the new width.
		let newWidth = !invert ?
			resizeParams.startingWidth + delta :
			resizeParams.startingWidth - delta;

		// Setup event processing state.
		let newCollapsed;
		let newCursor: string | undefined = undefined;
		if (newWidth < resizeParams.minimumWidth / 2) {
			newWidth = resizeParams.minimumWidth;
			newCollapsed = true;
			if (!endResize) {
				newCursor = isMacintosh ? 'col-resize' : 'ew-resize';
			}
		} else if (newWidth < resizeParams!.minimumWidth) {
			newWidth = resizeParams.minimumWidth;
			newCollapsed = false;
			if (!endResize) {
				newCursor = !invert ? 'e-resize' : 'w-resize';
			}
		} else if (newWidth > resizeParams!.maximumWidth) {
			newWidth = resizeParams.maximumWidth;
			newCollapsed = false;
			if (!endResize) {
				newCursor = !invert ? 'w-resize' : 'e-resize';
			}
		} else {
			newCollapsed = false;
			if (!endResize) {
				newCursor = isMacintosh ? 'col-resize' : 'ew-resize';
			}
		}

		// Set the cursor.
		if (newCursor) {
			resizeParams!.styleSheet.textContent = `* { cursor: ${newCursor} !important; }`;
		}

		// Perform the resize.
		onResize(newWidth);

		// Set the collapsed state.
		if (newCollapsed !== collapsed) {
			setCollapsed(newCollapsed);
			onCollapsedChanged?.(newCollapsed);
		}

		// End the resize.
		if (endResize) {
			sashRef.current.removeChild(resizeParams.styleSheet);
			hoveringDelayer.cancel();
			setResizeParams(undefined);
			setHovering(isPointInsideElement(e.clientX, e.clientY, sashRef.current));
		}
	};

	/**
	 * Expand / collapse button onPointerEnter handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const expandCollapseButtonPointerEnterHandler = (e: PointerEvent<HTMLDivElement>) => {
		hoveringDelayer.cancel();
		setHovering(true);
		setHighlightExpandCollapse(true);
	};

	/**
	 * Expand / collapse button onPointerLeave handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const expandCollapseButtonPointerLeaveHandler = (e: PointerEvent<HTMLDivElement>) => {
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
				onPointerEnter={sashPointerEnterHandler}
				onPointerLeave={sashPointerLeaveHandler}
				onPointerDown={sashPointerDownHandler}
				onPointerMove={sashPointerEventHandler}
				onLostPointerCapture={sashPointerEventHandler}
			>
				{showSash && (hovering || resizeParams) &&
					<div
						className={positronClassNames(
							'sash-indicator',
							{ 'hovering': showSash && hovering },
							{ 'resizing': showSash && resizeParams },
						)}
						style={{
							width: sashIndicatorWidth,
						}}
					/>
				}
			</div>
			{collapsible && (hovering || resizeParams || collapsed) &&
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
							!collapsed ?
								!invert ? 'codicon-chevron-left' : 'codicon-chevron-right' :
								!invert ? 'codicon-chevron-right' : 'codicon-chevron-left',
							{ highlighted: highlightExpandCollapse }
						)}
						onPointerEnter={expandCollapseButtonPointerEnterHandler}
						onPointerLeave={expandCollapseButtonPointerLeaveHandler}
					/>
				</Button>
			}
		</div>
	);
};
