/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronConsoleState, usePositronConsoleState } from './positronConsoleState.js';

/**
 * Create the Positron console context.
 */
const positronConsoleContext = createContext<PositronConsoleState>(undefined!);

/**
 * Export the PositronConsoleContextProvider provider
 */
export const PositronConsoleContextProvider = (props: PropsWithChildren<{}>) => {
	// Hooks.
	const positronConsoleState = usePositronConsoleState();

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
