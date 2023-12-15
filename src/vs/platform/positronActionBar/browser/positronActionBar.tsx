/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronActionBar';
import * as React from 'react';
import { PropsWithChildren, useEffect, KeyboardEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { optionalValue, positronClassNames } from 'vs/base/common/positronUtilities';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

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
	// State hooks.
	const { focusableComponents } = usePositronActionBarContext();
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
		switch (e.code) {
			case 'ArrowLeft': {
				e.preventDefault();
				e.stopPropagation();
				setPrevIndex(() => focusedIndex);
				if (focusedIndex === 0) {
					setFocusedIndex(focusableComponents.size - 1);
				} else {
					setFocusedIndex(() => focusedIndex - 1);
				}
				break;
			}
			case 'ArrowRight': {
				e.preventDefault();
				e.stopPropagation();
				setPrevIndex(() => focusedIndex);
				if (focusedIndex === focusableComponents.size - 1) {
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
				setFocusedIndex(() => focusableComponents.size - 1);
				break;
			}
		}
	};

	useEffect(() => {
		if (!props.nestedActionBar && prevIndex >= 0 && (focusedIndex !== prevIndex)) {
			const items = Array.from(focusableComponents);
			const currentNode = items[focusedIndex];
			const previousNode = items[prevIndex];

			previousNode.tabIndex = -1;
			currentNode.tabIndex = 0;
			currentNode.focus();
		}
	}, [focusedIndex, prevIndex, focusableComponents]);


	// Render.
	return (
		<div
			className={classNames}
			onKeyDown={props.nestedActionBar ? undefined : keyDownHandler}
			style={{
				gap: optionalValue(props.gap, 0),
				paddingLeft: optionalValue(props.paddingLeft, 0),
				paddingRight: optionalValue(props.paddingRight, 0)
			}}>
			{props.children}
		</div>
	);
};
