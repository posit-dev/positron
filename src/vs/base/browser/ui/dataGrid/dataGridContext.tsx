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
 * DataGridSettings interface.
 */
export interface DataGridServices {
	layoutService: ILayoutService;
}

/**
 * DataGridConfiguration interface.
 */
export interface DataGridConfiguration extends DataGridServices {
	instance: IDataGridInstance;
}

/**
 * DataGridState interface.
 */
interface DataGridState extends DataGridConfiguration {
}

/**
 * Create the data grid context.
 */
const DataGridContext = createContext<DataGridState>(undefined!);

/**
 * The useDataGridState custom hook.
 * @returns The hook.
 */
const useDataGridState = (
	configuration: DataGridConfiguration
): DataGridState => {
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
 * Export the DataGridContextProvider.
 */
export const DataGridContextProvider = (
	props: PropsWithChildren<DataGridConfiguration>
) => {
	// State hooks.
	const state = useDataGridState(props);

	// Render.
	return (
		<DataGridContext.Provider value={state}>
			{props.children}
		</DataGridContext.Provider>
	);
};

/**
 * Export useDataGridContext to simplify using the data grid context object.
 */
export const useDataGridContext = () => useContext(DataGridContext);
