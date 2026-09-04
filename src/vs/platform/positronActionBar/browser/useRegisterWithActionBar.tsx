/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MutableRefObject, useEffect, useRef } from 'react';
import { usePositronActionBarContext } from './positronActionBarContext.js';

/**
 * Custom hook to register a component with the Positron Action Bar; this is to enable
 * the roving tabindex pattern for keyboard navigation. Only one component at a time
 * in the Action Bar is focusable (i.e. tabindex=0) and the rest have tabindex=-1.
 * The arrow keys are used to move between the components in the Action Bar.
 */
export const useRegisterWithActionBar = (refs: MutableRefObject<HTMLElement>[]) => {
	const { focusableComponents } = usePositronActionBarContext();

	// Every call site passes an inline array literal, so `refs` is a different array on every
	// render. Holding it in a ref lets the effect below depend on the action bar alone. If the
	// effect re-ran on every render it would set tabIndex back to -1, leaving the bar with no
	// tab stop, and re-adding the element to the insertion-ordered set would move the component
	// to the end of the arrow-key order.
	const latestRefs = useRef(refs);
	latestRefs.current = refs;

	useEffect(() => {
		// Capture the elements now so the cleanup removes the same ones that were added, even if
		// a ref has since been pointed somewhere else.
		const elements = latestRefs.current.map(ref => ref.current);
		elements.forEach(element => {
			if (focusableComponents.size === 0) {
				element.tabIndex = 0; // initially the first component is focusable
			} else {
				element.tabIndex = -1;
			}
			focusableComponents.add(element);
		});
		return () => {
			elements.forEach(element => focusableComponents.delete(element));
		};
	}, [focusableComponents]);
};
