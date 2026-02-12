/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronPlotsState, usePositronPlotsState } from './positronPlotsState.js';

/**
 * Create the Positron plots context.
 */
const PositronPlotsContext = createContext<PositronPlotsState>(undefined!);

/**
 * Export the PositronPlotsContextProvider provider
 */
export const PositronPlotsContextProvider = (props: PropsWithChildren<{}>) => {
	// Hooks.
	const positronPlotsState = usePositronPlotsState();

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
