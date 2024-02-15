/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, createContext, useContext, useEffect } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronDataExplorerConfiguration } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorer';

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
