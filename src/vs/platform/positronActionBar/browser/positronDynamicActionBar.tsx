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
import { ActionBarSeparator } from './components/actionBarSeparator.js';
import { usePositronActionBarContext } from './positronActionBarContext.js';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { optionalValue, positronClassNames } from '../../../base/common/positronUtilities.js';

/**
 * Constants.
 */
const SEPARATOR_WIDTH = 7;

/**
 * DynamicActionBarAction interface.
 */
export interface DynamicActionBarAction {
	width: number;
	text?: string;
	separator: boolean;
	component: JSX.Element | (() => JSX.Element);
}

/**
 * CommonPositronActionBarProps interface.
 */
interface CommonPositronDynamicActionBarProps {
	size: 'small' | 'large';
	gap?: number;
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
	const gridElements: JSX.Element[] = [];
	if (refExemplar.current) {
		// Get the exemplar window and style.
		const exemplarWindow = DOM.getWindow(refExemplar.current);
		const style = DOM.getComputedStyle(refExemplar.current);

		// Create a canvas in the exemplar window, get it's 2D context, and set its font.
		const canvas = exemplarWindow.document.createElement('canvas');
		const canvasRenderingContext2D = canvas.getContext('2d');
		if (canvasRenderingContext2D) {
			canvasRenderingContext2D.font = style.font;
		}

		/**
		 * Measures the width of text in the canvas.
		 * @param text The text.
		 * @returns The text width.
		 */
		const measureTextWidth = (text: string) =>
			canvasRenderingContext2D ? Math.ceil(canvasRenderingContext2D.measureText(text).width) : 0;

		// Set the layout width.
		let layoutWidth = width - (props.paddingLeft ?? 0) - (props.paddingRight ?? 0);

		/**
		 * Processes actions into grid columns and grid elements.
		 * @param actions
		 * @returns
		 */
		const processActions = (actions: DynamicActionBarAction[]): [gridColumns: string[], gridElements: JSX.Element[]] => {
			// Process the actions into grid columns and grid elements.
			const gridColumns: string[] = [];
			const gridElements: JSX.Element[] = [];
			let appendSeparator = false;
			actions.forEach((action, index) => {
				// Measure the width of the text.
				const width = action.width + (!action.text ? 0 : measureTextWidth(action.text));

				// Get the component.
				const component = action.component instanceof Function ?
					action.component() :
					action.component;

				if (width + (appendSeparator ? SEPARATOR_WIDTH : 0) > layoutWidth) {
					// Append to the menu...
					return;
				}

				// Append the separator.
				if (appendSeparator && index <= actions.length - 1) {
					gridColumns.push(`${SEPARATOR_WIDTH}px`);
					gridElements.push(<ActionBarSeparator />);
					layoutWidth -= SEPARATOR_WIDTH;
					appendSeparator = false;
				}

				// Append the action.
				gridColumns.push(`${width}px`);
				gridElements.push(component);
				layoutWidth -= width;

				// Account for the gap.
				if (props.gap && props.gap <= layoutWidth && index <= actions.length - 1) {
					layoutWidth -= props.gap;
				}

				// Set the append separator flag for the next iteration.
				appendSeparator = action.separator;
			});

			// Return the layout width.
			return [gridColumns, gridElements];
		}

		// Process the left and right actions into grid columns and grid elements.
		const [rightGridColumns, rightGridElements] = processActions(props.rightActions);
		const [leftGridColumns, leftGridElements] = processActions(props.leftActions);

		// Remove the canvas.
		canvas.remove();

		// Construct the grid columns.
		gridColumns.push(...leftGridColumns);
		gridColumns.push('1fr');
		gridColumns.push(...rightGridColumns);

		// Construct the grid elements.
		gridElements.push(...leftGridElements);
		gridElements.push(<div />);
		gridElements.push(...rightGridElements);
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
		gap: optionalValue(props.gap, 0),
		paddingLeft: optionalValue(props.paddingLeft, 0),
		paddingRight: optionalValue(props.paddingRight, 0),
		gridTemplateColumns: gridColumns.join(' ')
	};

	// Render.
	return (
		<>
			<div ref={refExemplar} className='exemplar'>test</div>
			<div ref={refActionBar} className={classNames} style={style} onKeyDown={keyDownHandler}>
				{gridElements}
			</div>
		</>
	);
};
