/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { MutableRefObject, useEffect } from 'react';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * Custom hook to register a component with the Positron Action Bar; this is to enable
 * the roving tabindex pattern for keyboard navigation. Only one component at a time
 * in the Action Bar is focusable (i.e. tabindex=0) and the rest have tabindex=-1.
 * The arrow keys are used to move between the components in the Action Bar.
 */
export const useRegisterWithActionBar = (refs: MutableRefObject<HTMLElement>[]) => {
	const { focusableComponents } = usePositronActionBarContext();

	useEffect(() => {
		refs.forEach(ref => {
			if (focusableComponents.size === 0) {
				ref.current.tabIndex = 0; // initially the first component is focusable
			} else {
				ref.current.tabIndex = -1;
			}
			focusableComponents.add(ref.current);
		});
		return () => {
			refs.forEach(ref => focusableComponents.delete(ref.current));
		};
	}, []);
};
