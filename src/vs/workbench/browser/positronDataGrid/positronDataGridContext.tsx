/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext, useEffect } from 'react';

// Other dependencies.
import { DataGridInstance } from './classes/dataGridInstance.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';

/**
 * PositronDataGridConfiguration interface.
 */
export interface PositronDataGridConfiguration {
	instance: DataGridInstance;
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
const usePositronDataGridState = (configuration: PositronDataGridConfiguration): PositronDataGridState => {
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
export const PositronDataGridContextProvider = (props: PropsWithChildren<PositronDataGridConfiguration>) => {
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
