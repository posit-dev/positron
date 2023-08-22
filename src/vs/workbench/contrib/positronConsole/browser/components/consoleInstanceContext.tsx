/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { ConsoleInstanceState, useConsoleInstanceState } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInstanceState';

/**
 * Create the console instance context.
 */
const consoleInstanceContext = createContext<ConsoleInstanceState>(undefined!);

/**
 * Export the ConsoleInstanceContextProvider provider
 */
export const ConsoleInstanceContextProvider = (props: PropsWithChildren) => {
	// Hooks.
	const consoleInstanceState = useConsoleInstanceState();

	// Render.
	return (
		<consoleInstanceContext.Provider value={consoleInstanceState}>
			{props.children}
		</consoleInstanceContext.Provider>
	);
};

/**
 * Export useConsoleInstanceContext to simplify using the console instance context object.
 */
export const useConsoleInstanceContext = () => useContext(consoleInstanceContext);
