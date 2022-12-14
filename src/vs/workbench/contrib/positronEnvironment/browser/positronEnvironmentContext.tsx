/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronEnvironmentServices, PositronEnvironmentState, usePositronEnvironmentState } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentState';

/**
 * Create the Positron environment context.
 */
const PositronEnvironmentContext = createContext<PositronEnvironmentState>(undefined!);

/**
 * Export the PositronEnvironmentContextProvider provider
 */
export const PositronEnvironmentContextProvider = (props: PropsWithChildren<PositronEnvironmentServices>) => {
	// Hooks.
	const positronEnvironmentBarState = usePositronEnvironmentState(props);

	// Render.
	return (
		<PositronEnvironmentContext.Provider value={positronEnvironmentBarState}>
			{props.children}
		</PositronEnvironmentContext.Provider>
	);
};

/**
 * Export usePositronEnvironmentContext to simplify using the Positron environment context object.
 */
export const usePositronEnvironmentContext = () => useContext(PositronEnvironmentContext);
