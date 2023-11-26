/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { MutableRefObject, useEffect } from 'react';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

export const useRegisterWithActionBar = (refs: MutableRefObject<HTMLElement>[]) => {
	const positronActionBarContext = usePositronActionBarContext();

	useEffect(() => {
		refs.forEach(ref => positronActionBarContext.focusableComponents.add(ref.current));
		return () => {
			refs.forEach(ref => positronActionBarContext.focusableComponents.delete(ref.current));
		};
	}, []);
};
