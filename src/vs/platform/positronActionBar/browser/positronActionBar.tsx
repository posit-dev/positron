/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronActionBar.css';

// React.
import React, { KeyboardEvent, PropsWithChildren, useEffect, useLayoutEffect, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../base/browser/dom.js';
import { usePositronActionBarContext } from './positronActionBarContext.js';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { optionalValue, positronClassNames } from '../../../base/common/positronUtilities.js';

/**
 * CommonPositronActionBarProps interface.
 */
interface CommonPositronActionBarProps {
	size: 'small' | 'large';
	gap?: number;
	paddingLeft?: number;
	paddingRight?: number;
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
		{ 'transparent-background': props?.nestedActionBar },
		props.size
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

	// Automatic layout useEffect.
	useLayoutEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Allocate and initialize the resize observer.
		const resizeObserver = new ResizeObserver(entries => {
		});

		// Start observing the size of the action bar.
		resizeObserver.observe(ref.current);

		// Add the resize observer to the disposable store.
		disposableStore.add(toDisposable(() => resizeObserver.disconnect()));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [context]);

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


	// Render.
	return (
		<div
			ref={ref}
			className={classNames}
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
