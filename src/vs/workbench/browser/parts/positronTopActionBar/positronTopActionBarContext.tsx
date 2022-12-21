/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronTopActionBarServices } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBar';
import { PositronTopActionBarState, usePositronTopActionBarState } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarState';

/**
 * Create the Positron top action bar context.
 */
const PositronTopActionBarContext = createContext<PositronTopActionBarState>(undefined!);

/**
 * Export the PositronTopActionBarContextProvider provider
 */
export const PositronTopActionBarContextProvider = (props: PropsWithChildren<PositronTopActionBarServices>) => {
	// Hooks.
	const positronTopActionBarState = usePositronTopActionBarState(props);

	// Render.
	return (
		<PositronTopActionBarContext.Provider value={positronTopActionBarState}>
			{props.children}
		</PositronTopActionBarContext.Provider>
	);
};

/**
 * Export usePositronTopActionBarContext to simplify using the Positron top action bar context object.
 */
export const usePositronTopActionBarContext = () => useContext(PositronTopActionBarContext);
