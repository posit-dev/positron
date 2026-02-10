/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronActionBarState, usePositronActionBarState } from './positronActionBarState.js';

/**
 * Create the Positron action bar context.
 */
const PositronActionBarContext = createContext<PositronActionBarState>(undefined!);

/**
 * Export the PositronActionBarContextProvider provider
 */
export const PositronActionBarContextProvider = (props: PropsWithChildren<{}>) => {
	// Hooks.
	const positronActionBarState = usePositronActionBarState();

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
