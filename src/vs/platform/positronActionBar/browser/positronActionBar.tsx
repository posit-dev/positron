/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronActionBarVariables.css';
import './positronActionBar.css';

// React.
import React, { KeyboardEvent, PropsWithChildren, useEffect, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../base/browser/dom.js';
import { usePositronActionBarContext } from './positronActionBarContext.js';
import { optionalValue, positronClassNames } from '../../../base/common/positronUtilities.js';

/**
 * CommonPositronActionBarProps interface.
 */
interface CommonPositronActionBarProps {
	gap?: number;
	paddingLeft?: number;
	paddingRight?: number;
	/**
	 * Names the bar for assistive technology. Give one to any bar a keyboard user can reach: a
	 * screen reader reads it before the toolbar's controls, so "Editor actions toolbar" tells
	 * someone where they have landed and an unnamed one leaves them to guess from the buttons.
	 */
	ariaLabel?: string;
}

/**
 * NestedPositronActionBarProps interface.
 */
type NestedPositronActionBarProps =
	| { nestedActionBar?: true; borderTop?: never; borderBottom?: never }
	| { nestedActionBar?: false | undefined; borderTop?: boolean; borderBottom?: boolean };

/**
 * PositronActionBarProps interface.
 */
type PositronActionBarProps = CommonPositronActionBarProps & NestedPositronActionBarProps;

/**
 * PositronActionBar component.
 * @param props A PositronActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronActionBar = (props: PropsWithChildren<PositronActionBarProps>) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [focusedIndex, setFocusedIndex] = React.useState(0);
	const [prevIndex, setPrevIndex] = React.useState(-1);

	// Create the class names.
	const classNames = positronClassNames(
		'positron-action-bar',
		{ 'border-top': props?.borderTop },
		{ 'border-bottom': props?.borderBottom },
		{ 'transparent-background': props?.nestedActionBar }
	);

	// Handle keyboard navigation
	const keyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
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
			// Controls register themselves as they mount, so the set is in mount order. A control
			// an extension contributes lands at the end of it whatever its place on screen,
			// because the extension activates after the bar is already up: Quarto's Render on Save
			// checkbox sits between two of Positron's own buttons and used to come after both of
			// them. Sorting by document position makes the arrow keys follow what is on screen.
			const items = Array.from(context.focusableComponents).sort((a, b) =>
				a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
			);
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


	// Render.
	return (
		<div
			ref={ref}
			aria-label={props.nestedActionBar ? undefined : props.ariaLabel}
			className={classNames}
			// A bar that handles the arrow keys is a toolbar, and has to say so. Tab reaches one
			// control in it and the arrows move between them, which a keyboard user can only be
			// expected to work out if the bar announces itself as a toolbar. A nested bar leaves
			// the keys to its parent, so it is not one.
			role={props.nestedActionBar ? undefined : 'toolbar'}
			style={{
				gap: optionalValue(props.gap, 0),
				paddingLeft: optionalValue(props.paddingLeft, 0),
				paddingRight: optionalValue(props.paddingRight, 0)
			}}
			onKeyDown={props.nestedActionBar ? undefined : keyDownHandler}>
			{props.children}
		</div>
	);
};
