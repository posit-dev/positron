/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronSessionsServices, PositronSessionsState, usePositronSessionsState } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronSessionsState';

/**
 * Create the Positron variables context.
 */
const PositronSessionsContext = createContext<PositronSessionsState>(undefined!);

/**
 * Export the PositronSessionsContextProvider.
 */
export const PositronSessionsContextProvider = (
	props: PropsWithChildren<PositronSessionsServices>
) => {
	// State hooks.
	const positronSessionsState = usePositronSessionsState(props);

	// Render.
	return (
		<PositronSessionsContext.Provider value={positronSessionsState}>
			{props.children}
		</PositronSessionsContext.Provider>
	);
};

/**
 * Export usePositronSessionsContext to simplify using the Positron variables context object.
 */
export const usePositronSessionsContext = () => useContext(PositronSessionsContext);
