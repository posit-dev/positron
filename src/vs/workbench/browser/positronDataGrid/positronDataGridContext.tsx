/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext, useEffect } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ILayoutService } from '../../../platform/layout/browser/layoutService.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { DataGridInstance } from './classes/dataGridInstance.js';

/**
 * PositronDataGridServices interface.
 */
export interface PositronDataGridServices {
	configurationService: IConfigurationService;
	layoutService: ILayoutService;
}

/**
 * PositronDataGridConfiguration interface.
 */
export interface PositronDataGridConfiguration extends PositronDataGridServices {
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
