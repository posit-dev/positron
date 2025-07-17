/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronTopActionBarState, usePositronTopActionBarState } from './positronTopActionBarState.js';

/**
 * Create the Positron top action bar context.
 */
const PositronTopActionBarContext = createContext<PositronTopActionBarState>(undefined!);

/**
 * Export the PositronTopActionBarContextProvider provider
 */
export const PositronTopActionBarContextProvider = (props: PropsWithChildren<{}>) => {
	// Hooks.
	const positronTopActionBarState = usePositronTopActionBarState();

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
