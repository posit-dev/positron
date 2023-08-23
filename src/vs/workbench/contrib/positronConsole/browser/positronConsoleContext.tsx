/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronConsoleServices, PositronConsoleState, usePositronConsoleState } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleState';

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
