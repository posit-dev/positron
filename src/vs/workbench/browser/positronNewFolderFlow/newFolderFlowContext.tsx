/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { NewFolderFlowStateManager, NewFolderFlowStateConfig } from './newFolderFlowState.js';

/**
 * Create the New Folder Flow context.
 */
const NewFolderFlowContext = createContext<NewFolderFlowStateManager | undefined>(undefined);

/**
 * Export the NewFolderFlowContextProvider provider.
 */
export const NewFolderFlowContextProvider = (props: PropsWithChildren<NewFolderFlowStateConfig>) => {
	// Hooks.
	const state = new NewFolderFlowStateManager(props);

	// Render.
	return (
		<NewFolderFlowContext.Provider value={state}>
			{props.children}
		</NewFolderFlowContext.Provider>
	);
};

/**
 * Export useNewFolderFlowContext to simplify using the New Folder Flow context object.
 */
export const useNewFolderFlowContext = () => {
	const state = useContext(NewFolderFlowContext);
	if (!state) {
		throw new Error('No New Folder Flow context provided');
	}
	return state;
};
