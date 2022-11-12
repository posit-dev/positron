/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { PositronActionBarState, usePositronActionBarState } from 'vs/platform/positronActionBar/browser/positronActionBarState';

/**
 * Create the Positron action bar context.
 */
const PositronActionBarContext = createContext<PositronActionBarState>(undefined!);

/**
 * Export the PositronActionBarContextProvider provider
 */
export const PositronActionBarContextProvider = (props: PropsWithChildren<PositronActionBarServices>) => {
	// Hooks.
	const positronActionBarState = usePositronActionBarState(props);

	// Render.
	return (
		<PositronActionBarContext.Provider value={positronActionBarState}>
			{props.children}
		</PositronActionBarContext.Provider>
	);
};

/**
 * Export usePositronActionBarContext to simplify using the Positron action bar context object.
 */
export const usePositronActionBarContext = () => useContext(PositronActionBarContext);
