/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, createContext, useContext, useEffect } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IDataGridInstance } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';

/**
 * PositronDataGridServices interface.
 */
export interface PositronDataGridServices {
	layoutService: ILayoutService;
}

/**
 * PositronDataGridConfiguration interface.
 */
export interface PositronDataGridConfiguration extends PositronDataGridServices {
	instance: IDataGridInstance;
}

/**
 * PositronDataGridState interface.
 */
interface PositronDataGridState extends PositronDataGridConfiguration {
}

/**
 * Create the data grid context.
 */
const PositronDataGridContext = createContext<PositronDataGridState>(undefined!);

/**
 * The useDataGridState custom hook.
 * @returns The hook.
 */
const usePositronDataGridState = (
	configuration: PositronDataGridConfiguration
): PositronDataGridState => {
	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron data grid state.
	return {
		...configuration,
	};
};

/**
 * Export the PositronDataGridContextProvider.
 */
export const PositronDataGridContextProvider = (
	props: PropsWithChildren<PositronDataGridConfiguration>
) => {
	// State hooks.
	const state = usePositronDataGridState(props);

	// Render.
	return (
		<PositronDataGridContext.Provider value={state}>
			{props.children}
		</PositronDataGridContext.Provider>
	);
};

/**
 * Export usePositronDataGridContext to simplify using the data grid context object.
 */
export const usePositronDataGridContext = () => useContext(PositronDataGridContext);
