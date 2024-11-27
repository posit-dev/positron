/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronVariablesServices, PositronVariablesState, usePositronVariablesState } from './positronVariablesState.js';

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
