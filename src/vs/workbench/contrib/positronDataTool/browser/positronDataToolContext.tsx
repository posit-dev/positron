/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronDataToolConfiguration, PositronDataToolState, usePositronDataToolState } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolState';

/**
 * Create the Positron data tool context.
 */
const PositronDataToolContext = createContext<PositronDataToolState>(undefined!);

/**
 * Export the PositronDataToolContextProvider.
 */
export const PositronDataToolContextProvider = (
	props: PropsWithChildren<PositronDataToolConfiguration>
) => {
	// State hooks.
	const state = usePositronDataToolState(props);

	// Render.
	return (
		<PositronDataToolContext.Provider value={state}>
			{props.children}
		</PositronDataToolContext.Provider>
	);
};

/**
 * Export usePositronDataToolContext to simplify using the Positron data tool context object.
 */
export const usePositronDataToolContext = () => useContext(PositronDataToolContext);
