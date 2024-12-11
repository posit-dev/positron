/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { NewProjectWizardStateManager, NewProjectWizardStateConfig } from './newProjectWizardState.js';

/**
 * Create the New Project Wizard context.
 */
const NewProjectWizardContext = createContext<
	NewProjectWizardStateManager | undefined
>(undefined);

/**
 * Export the NewProjectWizardContextProvider provider.
 */
export const NewProjectWizardContextProvider = (
	props: PropsWithChildren<NewProjectWizardStateConfig>
) => {
	// Hooks.
	const state = new NewProjectWizardStateManager(props);

	// Render.
	return (
		<NewProjectWizardContext.Provider value={state}>
			{props.children}
		</NewProjectWizardContext.Provider>
	);
};

/**
 * Export useNewProjectWizardContext to simplify using the New Project Wizard context object.
 */
export const useNewProjectWizardContext = () => {
	const state = useContext(NewProjectWizardContext);
	if (!state) {
		throw new Error('No new project wizard context provided');
	}
	return state;
};
