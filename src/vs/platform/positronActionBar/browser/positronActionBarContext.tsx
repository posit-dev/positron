/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronActionBarServices, PositronActionBarState, usePositronActionBarState } from './positronActionBarState.js';

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
