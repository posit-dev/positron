/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronRuntimeSessionsState, usePositronRuntimeSessionsState } from './positronRuntimeSessionsState.js';

/**
 * Create the Positron sessions context.
 */
const PositronRuntimeSessionsContext = createContext<PositronRuntimeSessionsState>(undefined!);

/**
 * Export the PositronSessionsContextProvider.
 */
export const PositronSessionsContextProvider = (props: PropsWithChildren<{}>) => {
	// State hooks.
	const positronSessionsState = usePositronRuntimeSessionsState();

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
