/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronPlotsServices, PositronPlotsState, usePositronPlotsState } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsState';

/**
 * Create the Positron plots context.
 */
const PositronPlotsContext = createContext<PositronPlotsState>(undefined!);

/**
 * Export the PositronPlotsContextProvider provider
 */
export const PositronPlotsContextProvider = (props: PropsWithChildren<PositronPlotsServices>) => {
	// Hooks.
	const positronPlotsState = usePositronPlotsState(props);

	// Render.
	return (
		<PositronPlotsContext.Provider value={positronPlotsState}>
			{props.children}
		</PositronPlotsContext.Provider>
	);
};

/**
 * Export usePositronPlotsContext to simplify using the Positron plots context object.
 */
export const usePositronPlotsContext = () => useContext(PositronPlotsContext);
