/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext, useEffect } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { PositronDataExplorerConfiguration } from './positronDataExplorer.js';

/**
 * PositronDataExplorerState interface.
 */
interface PositronDataExplorerState extends PositronDataExplorerConfiguration {
}

/**
 * Create the Positron data explorer context.
 */
const PositronDataExplorerContext = createContext<PositronDataExplorerState>(undefined!);

/**
 * The usePositronDataExplorerState custom hook.
 * @returns The hook.
 */
const usePositronDataExplorerState = (
	configuration: PositronDataExplorerConfiguration
): PositronDataExplorerState => {
	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron data explorer state.
	return {
		...configuration,
	};
};

/**
 * Export the PositronDataExplorerContextProvider.
 */
export const PositronDataExplorerContextProvider = (
	props: PropsWithChildren<PositronDataExplorerConfiguration>
) => {
	// State hooks.
	const state = usePositronDataExplorerState(props);

	// Render.
	return (
		<PositronDataExplorerContext.Provider value={state}>
			{props.children}
		</PositronDataExplorerContext.Provider>
	);
};

/**
 * Export usePositronDataExplorerContext to simplify using the Positron data explorer context.
 */
export const usePositronDataExplorerContext = () => useContext(PositronDataExplorerContext);
