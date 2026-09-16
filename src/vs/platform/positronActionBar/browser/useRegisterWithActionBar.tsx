/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MutableRefObject, useEffect } from 'react';
import { usePositronActionBarContext } from './positronActionBarContext.js';

/**
 * Custom hook to register a component with the Positron Action Bar; this is to enable
 * the roving tabindex pattern for keyboard navigation. Only one component at a time
 * in the Action Bar is focusable (i.e. tabindex=0) and the rest have tabindex=-1.
 * The arrow keys are used to move between the components in the Action Bar.
 */
export const useRegisterWithActionBar = (refs: MutableRefObject<HTMLElement | undefined>[]) => {
	const { focusableComponents } = usePositronActionBarContext();

	useEffect(() => {
		const elements = refs.map(ref => ref.current).filter(element => element !== undefined);
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
	}, [focusableComponents, refs]);
};
