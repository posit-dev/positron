/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronSessionsServices, PositronRuntimeSessionsState, usePositronRuntimeSessionsState } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsState';

/**
 * Create the Positron sessions context.
 */
const PositronRuntimeSessionsContext = createContext<PositronRuntimeSessionsState>(undefined!);

/**
 * Export the PositronSessionsContextProvider.
 */
export const PositronSessionsContextProvider = (
	props: PropsWithChildren<PositronSessionsServices>
) => {
	// State hooks.
	const positronSessionsState = usePositronRuntimeSessionsState(props);

	// Render.
	return (
		<PositronRuntimeSessionsContext.Provider value={positronSessionsState}>
			{props.children}
		</PositronRuntimeSessionsContext.Provider>
	);
};

/**
 * Export usePositronSessionsContext to simplify using the Positron variables context object.
 */
export const usePositronRuntimeSessionsContext = () => useContext(PositronRuntimeSessionsContext);
