/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronVariablesServices, PositronVariablesState, usePositronVariablesState } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesState';

/**
 * Create the Positron variables context.
 */
const PositronVariablesContext = createContext<PositronVariablesState>(undefined!);

/**
 * Export the PositronVariablesContextProvider.
 */
export const PositronVariablesContextProvider = (
	props: PropsWithChildren<PositronVariablesServices>
) => {
	// State hooks.
	const positronVariablesState = usePositronVariablesState(props);

	// Render.
	return (
		<PositronVariablesContext.Provider value={positronVariablesState}>
			{props.children}
		</PositronVariablesContext.Provider>
	);
};

/**
 * Export usePositronVariablesContext to simplify using the Positron variables context object.
 */
export const usePositronVariablesContext = () => useContext(PositronVariablesContext);
