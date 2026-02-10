/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronVariablesState, usePositronVariablesState } from './positronVariablesState.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';

/**
 * Create the Positron variables context.
 */
const PositronVariablesContext = createContext<PositronVariablesState>(undefined!);

/**
 * PositronVariablesEnvironment interface.
 */
export interface PositronVariablesEnvironment {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * Export the PositronVariablesContextProvider.
 */
export const PositronVariablesContextProvider = (props: PropsWithChildren<PositronVariablesEnvironment>) => {
	// State hooks.
	const positronVariablesState = usePositronVariablesState(props);

	// Render.
	return (
		<PositronVariablesContext.Provider value={positronVariablesState}>
			{props.children}
		</PositronVariablesContext.Provider>
	);
};

/**
 * Export usePositronVariablesContext to simplify using the Positron variables context object.
 */
export const usePositronVariablesContext = () => useContext(PositronVariablesContext);
