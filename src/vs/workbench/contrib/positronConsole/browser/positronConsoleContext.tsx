/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronConsoleServices, PositronConsoleState, usePositronConsoleState } from './positronConsoleState.js';

/**
 * Create the Positron console context.
 */
const positronConsoleContext = createContext<PositronConsoleState>(undefined!);

/**
 * Export the PositronConsoleContextProvider provider
 */
export const PositronConsoleContextProvider = (props: PropsWithChildren<PositronConsoleServices>) => {
	// Hooks.
	const positronConsoleState = usePositronConsoleState(props);

	// Render.
	return (
		<positronConsoleContext.Provider value={positronConsoleState}>
			{props.children}
		</positronConsoleContext.Provider>
	);
};

/**
 * Export usePositronConsoleContext to simplify using the Positron console context object.
 */
export const usePositronConsoleContext = () => useContext(positronConsoleContext);
