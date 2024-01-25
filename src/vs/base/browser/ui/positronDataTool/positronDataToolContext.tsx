/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, createContext, useContext, useEffect } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronDataToolConfiguration } from 'vs/base/browser/ui/positronDataTool/positronDataTool';

/**
 * PositronDataToolState interface.
 */
interface PositronDataToolState extends PositronDataToolConfiguration {
}

/**
 * Create the Positron data tool context.
 */
const PositronDataToolContext = createContext<PositronDataToolState>(undefined!);

/**
 * The usePositronDataToolState custom hook.
 * @returns The hook.
 */
const usePositronDataToolState = (
	configuration: PositronDataToolConfiguration
): PositronDataToolState => {
	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron data tool state.
	return {
		...configuration,
	};
};

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
