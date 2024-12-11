/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronTopActionBarServices } from './positronTopActionBar.js';
import { PositronTopActionBarState, usePositronTopActionBarState } from './positronTopActionBarState.js';

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
