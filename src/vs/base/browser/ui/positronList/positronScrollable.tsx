/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronScrollable';
import * as React from 'react';
import { isWeb } from 'vs/base/common/platform';
import { PropsWithChildren, useCallback, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * PositronScrollable props.
 */
export interface PositronScrollableProps {
	// TODO@softwarenerd - For the moment, PositronScrollable only deals in vertical scrolling.
	// When there is a solid scenaro for horizontal scrolling, PositronScrollableProps will be
	// augmented with options to allow higher level components to control what can be scrolled.
	// Soon, events will be added to so this component will behave like react-window.
}

/**
 * PositronScrollable component.
 * @param props A PositronScrollableProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronScrollable = (props: PropsWithChildren<PositronScrollableProps>) => {
	// Hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// Memoize the wheel event handler.
	const wheelHandler = useCallback((e: WheelEvent) => {
		// At the moment, only scroll vertically.
		ref.current.scrollBy(0, e.deltaY);
	}, []);

	// Add event handlers.
	React.useEffect(() => {
		// We only need to listen for the wheel event when isWeb is true.
		if (!isWeb) {
			return;
		}

		// Add the wheel event handler.
		const WHEEL = 'wheel';
		ref.current.addEventListener(WHEEL, wheelHandler, false);

		// Return the cleanup function that removes the wheel handler.
		return () => {
			ref.current.addEventListener(WHEEL, wheelHandler, false);
		};
	}, []);

	// Render.
	return (
		<div ref={ref} className='positron-scrollable'>
			{props.children}
		</div>
	);
};
