/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDynamicActionBar.css';

// React.
import React, { CSSProperties, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../base/browser/dom.js';
import { ActionBarButton } from './components/actionBarButton.js';
import { ActionBarSeparator } from './components/actionBarSeparator.js';
import { usePositronActionBarContext } from './positronActionBarContext.js';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { optionalValue, positronClassNames } from '../../../base/common/positronUtilities.js';
import { CustomContextMenuSeparator } from '../../../workbench/browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem, CustomContextMenuItemOptions } from '../../../workbench/browser/positronComponents/customContextMenu/customContextMenuItem.js';

/**
 * Constants.
 */
export const DEFAULT_ACTION_BAR_BUTTON_WIDTH = 28;
export const DEFAULT_ACTION_BAR_SEPARATOR_WIDTH = 7;

/**
 * OverflowContextMenuItem interface.
 */
export interface OverflowContextMenuItem extends CustomContextMenuItemOptions {
}

/**
 * DynamicActionBarAction interface.
 */
export interface DynamicActionBarAction {
	/**
	 * The fixed width of the action.
	 */
	fixedWidth: number;

	/**
	 * The text of the action. This width of this text will be measured and
	 * added to the fixed width to calculate the width of the action.
	 */
	text?: string;

	/**
	 * A value indicating whether the action should be followed by a separator.
	 */
	separator: boolean;

	/**
	 * The component to be rendered for the action bar.
	 */
	component: JSX.Element | (() => JSX.Element);

	/**
	 * The overflow custom context menu item.
	 */
	overflowContextMenuItem?: OverflowContextMenuItem;
}

/**
 * CommonPositronActionBarProps interface.
 */
interface CommonPositronDynamicActionBarProps {
	size: 'small' | 'large';
	paddingLeft?: number;
	paddingRight?: number;
	leftActions: DynamicActionBarAction[];
	rightActions: DynamicActionBarAction[];
}

/**
 * NestedPositronDynamicActionBarProps interface.
 */
type NestedPositronDynamicActionBarProps = | {
	nestedActionBar?: true;
	borderTop?: never;
	borderBottom?: never
} | {
	nestedActionBar?: false | undefined;
	borderTop?: boolean;
	borderBottom?: boolean
};

/**
 * PositronDynamicActionBarProps interface.
 */
type PositronDynamicActionBarProps =
	CommonPositronDynamicActionBarProps &
	NestedPositronDynamicActionBarProps;

/**
 * PositronDynamicActionBar component.
 * @param props A PositronDynamicActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDynamicActionBar = (props: PositronDynamicActionBarProps) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	// Reference hooks.
	const refActionBar = useRef<HTMLDivElement>(undefined!);
	const refExemplar = useRef<HTMLDivElement>(undefined!);
	const refOverflowButton = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [width, setWidth] = useState(0);
	const [focusedIndex, setFocusedIndex] = React.useState(0);
	const [prevIndex, setPrevIndex] = React.useState(-1);

	// Width useLayoutEffect. This is only for setting or updating the width state.
	useLayoutEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Set the initial width.
		setWidth(refActionBar.current.offsetWidth);

		// Allocate and initialize the resize observer.
		const resizeObserver = new ResizeObserver(entries => {
			setWidth(refActionBar.current.offsetWidth);
			// Update the width state.
			// setWidth(entries[0].contentRect.width);
		});

		// Start observing the size of the action bar.
		resizeObserver.observe(refActionBar.current);

		// Add the resize observer to the disposable store.
		disposableStore.add(toDisposable(() => resizeObserver.disconnect()));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	// Handle keyboard navigation
	const keyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
		if (props.nestedActionBar) {
			return;
		}

		// Let keyboard events pass through to text controls
		if (DOM.isHTMLInputElement(e.target)) {
			const input = e.target as HTMLInputElement;
			if (input.type === 'text') {
				return;
			}
		}

		switch (e.code) {
			case 'ArrowLeft': {
				e.preventDefault();
				e.stopPropagation();
				setPrevIndex(() => focusedIndex);
				if (focusedIndex === 0) {
					setFocusedIndex(context.focusableComponents.size - 1);
				} else {
					setFocusedIndex(() => focusedIndex - 1);
				}
				break;
			}
			case 'ArrowRight': {
				e.preventDefault();
				e.stopPropagation();
				setPrevIndex(() => focusedIndex);
				if (focusedIndex === context.focusableComponents.size - 1) {
					setFocusedIndex(0);
				} else {
					setFocusedIndex(() => focusedIndex + 1);
				}
				break;
			}
			case 'Home': {
				e.preventDefault();
				e.stopPropagation();
				setPrevIndex(() => focusedIndex);
				setFocusedIndex(0);
				break;
			}
			case 'End': {
				e.preventDefault();
				e.stopPropagation();
				setPrevIndex(() => focusedIndex);
				setFocusedIndex(() => context.focusableComponents.size - 1);
				break;
			}
		}
	};

	useEffect(() => {
		if (!props.nestedActionBar && prevIndex >= 0 && (focusedIndex !== prevIndex)) {
			const items = Array.from(context.focusableComponents);
			const currentNode = items[focusedIndex];
			const previousNode = items[prevIndex];

			if (previousNode) {
				previousNode.tabIndex = -1;
			}
			if (currentNode) {
				currentNode.tabIndex = 0;
				currentNode.focus();
			}
		}
	}, [context.focusableComponents, focusedIndex, prevIndex, props.nestedActionBar]);

	// If the exemplar is available, we can calculate widths and construct the grid.
	const gridColumns: string[] = [];
	const gridComponents: JSX.Element[] = [];
	if (refExemplar.current) {
		// Get the exemplar window and style.
		const exemplarWindow = DOM.getWindow(refExemplar.current);
		const style = DOM.getComputedStyle(refExemplar.current);

		// Create a canvas in the exemplar window.
		const canvas = exemplarWindow.document.createElement('canvas');

		// Get the canvas rendering 2D context and set its font.
		const canvasRenderingContext2D = canvas.getContext('2d');
		if (!canvasRenderingContext2D) {
			return null;
		}
		canvasRenderingContext2D.font = style.font;

		/**
		 * Measures the width of text in the canvas.
		 * @param text The text.
		 * @returns The text width.
		 */
		const measureTextWidth = (text: string) => Math.ceil(canvasRenderingContext2D.measureText(text).width);

		// Setup layout conditions.
		let layoutWidth = Math.max(width - (props.paddingLeft ?? 0) - (props.paddingRight ?? 0), 0) - DEFAULT_ACTION_BAR_BUTTON_WIDTH;
		let overflowing = layoutWidth === 0;

		// Grid entry interface.
		interface GridEntry { width: number; action: DynamicActionBarAction; }

		/**
		 * Lays out the specified actions.
		 * @param actions The actions to layout.
		 * @param gridEntries The grid entries.
		 * @param overflowActions The overflow actions.
		 */
		const layoutActions = (actions: DynamicActionBarAction[], gridEntries: GridEntry[], overflowActions: DynamicActionBarAction[]) => {
			// Handle overflowing.
			if (overflowing) {
				overflowActions.push(...actions.filter(action => action.overflowContextMenuItem));
				return;
			}

			// Layout the actions.
			let appendSeparator = false;
			for (let i = 0; i < actions.length; i++) {
				// Set the separator width.
				const separatorWidth = appendSeparator ? DEFAULT_ACTION_BAR_SEPARATOR_WIDTH : 0;

				// Get the action.
				const action = actions[i];

				// Calculate the width of the action.
				let width = 0;
				if (action.fixedWidth) {
					width += action.fixedWidth;
				}
				if (action.text) {
					width += measureTextWidth(action.text);
				}

				// Handle overflowing.
				if (separatorWidth + width > layoutWidth) {
					overflowing = true;
					overflowActions.push(...actions.slice(i).filter(action => action.overflowContextMenuItem));
					return;
				}

				// Push the grid entry for the action.
				gridEntries.push({ width, action });

				// Adjust the layout width for the next iteration.
				layoutWidth -= separatorWidth + width;

				// Set the append separator flag for the next iteration.
				appendSeparator = action.separator;
			}
		}

		// Layout the right actions.
		const rightGridEntries: GridEntry[] = [];
		const rightOverflowActions: DynamicActionBarAction[] = [];
		layoutActions(props.rightActions, rightGridEntries, rightOverflowActions);

		// Layout the left actions.
		const leftGridEntries: GridEntry[] = [];
		const leftOverflowActions: DynamicActionBarAction[] = [];
		layoutActions(props.leftActions, leftGridEntries, leftOverflowActions);

		// Text measurement is complete. Remove the canvas.
		canvas.remove();

		/**
		 * Lays out the grid entries.
		 * @param gridEntries The grid entries.
		 * @returns
		 */
		const layoutGridEntries = (gridEntries: GridEntry[]): [gridColumns: string[], gridElements: JSX.Element[]] => {
			// Create the grid columns and grid elements.
			const gridColumns: string[] = [];
			const gridElements: JSX.Element[] = [];

			// Layout the grid entries.
			let appendSeparator = false;
			gridEntries.forEach((gridEntry, index) => {
				// Append the separator.
				if (appendSeparator) {
					gridColumns.push(`${DEFAULT_ACTION_BAR_SEPARATOR_WIDTH}px`);
					gridElements.push(
						<div className='container'>
							<ActionBarSeparator />
						</div>
					);
				}

				// Layout the grid entry.
				gridColumns.push(`${gridEntry.width}px`);
				gridElements.push(
					<div className='container'>
						{gridEntry.action.component instanceof Function ?
							gridEntry.action.component() :
							gridEntry.action.component
						}
					</div>
				);

				// Set the append separator flag for the next iteration.
				appendSeparator = gridEntry.action.separator;
			});

			// Return the grid columns and grid elements tuple.
			return [gridColumns, gridElements];
		};

		// Layout the left and right grid entries.
		const [leftGridColumns, leftGridElements] = layoutGridEntries(leftGridEntries);
		const [rightGridColumns, rightGridElements] = layoutGridEntries(rightGridEntries);

		// Create the overflow actions.
		const overflowActions = [...rightOverflowActions, ...leftOverflowActions];

		// If there are overflow actions, add the overflow button.
		if (overflowActions.length) {
			rightGridColumns.push(`${DEFAULT_ACTION_BAR_BUTTON_WIDTH}px`);
			rightGridElements.push(
				<div style={{ display: 'flex', width: `${DEFAULT_ACTION_BAR_BUTTON_WIDTH}px` }}>
					<ActionBarButton
						ref={refOverflowButton}
						align='right'
						ariaLabel={'overflow'}
						iconId='toolbar-more'
						tooltip={'overflow'}
						onPressed={async () => {
							// The custom context menu entries for the overflow context menu.
							const customContextMenuEntries: CustomContextMenuEntry[] = [];

							// Build the left custom context menu entries for the overflow context menu
							leftOverflowActions.filter(overflowAction => overflowAction.overflowContextMenuItem).forEach((overflowAction, index, overflowActions) => {
								// Add the custom context menu entry.
								customContextMenuEntries.push(new CustomContextMenuItem(overflowAction.overflowContextMenuItem!));

								// Add the custom context menu separator, if needed.
								if (overflowAction.separator && index < overflowActions.length - 1) {
									customContextMenuEntries.push(new CustomContextMenuSeparator());
								}
							});

							// Build the right custom context menu entries for the overflow context menu
							rightOverflowActions.filter(overflowAction => overflowAction.overflowContextMenuItem).forEach((overflowAction, index, overflowActions) => {
								// Add a separator between the left custom context menu entries and the right custom context menu entries.
								if (!index && customContextMenuEntries.length) {
									customContextMenuEntries.push(new CustomContextMenuSeparator());
								}

								// Add the custom context menu entry.
								customContextMenuEntries.push(new CustomContextMenuItem(overflowAction.overflowContextMenuItem!));

								// Add the custom context menu separator, if needed.
								if (overflowAction.separator && index < overflowActions.length - 1) {
									customContextMenuEntries.push(new CustomContextMenuSeparator());
								}
							});

							// Show the custom context.
							await showCustomContextMenu({
								commandService: context.commandService,
								keybindingService: context.keybindingService,
								layoutService: context.layoutService,
								anchorElement: refOverflowButton.current,
								popupPosition: 'auto',
								popupAlignment: 'auto',
								width: 'auto',
								entries: customContextMenuEntries
							});
						}}
					/>
				</div>
			);
		}

		// Construct the grid columns.
		gridColumns.push(...leftGridColumns);
		gridColumns.push('1fr');
		gridColumns.push(...rightGridColumns);

		// Construct the grid elements.
		gridComponents.push(...leftGridElements);
		gridComponents.push(<div />);
		gridComponents.push(...rightGridElements);
	}

	// Create the class names.
	const classNames = positronClassNames(
		'positron-dynamic-action-bar',
		{ 'border-top': props?.borderTop },
		{ 'border-bottom': props?.borderBottom },
		{ 'transparent-background': props?.nestedActionBar },
		props.size
	);

	// Create the dynamic style.
	const style: CSSProperties = {
		paddingLeft: optionalValue(props.paddingLeft, 0),
		paddingRight: optionalValue(props.paddingRight, 0),
		gridTemplateColumns: gridColumns.join(' ')
	};

	// Render.
	return (
		<>
			<div ref={refExemplar} className='exemplar' />
			<div ref={refActionBar} className={classNames} style={style} onKeyDown={keyDownHandler}>
				{gridComponents}
			</div>
		</>
	);
};
