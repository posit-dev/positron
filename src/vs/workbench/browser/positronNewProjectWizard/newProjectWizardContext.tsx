/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { NewProjectWizardState, NewProjectWizardStateProps, useNewProjectWizardState } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardState';

/**
 * Create the New Project Wizard context.
 */
const NewProjectWizardContext = createContext<NewProjectWizardState | undefined>(undefined);

/**
 * Export the NewProjectWizardContextProvider provider
 */
export const NewProjectWizardContextProvider = (props: PropsWithChildren<NewProjectWizardStateProps>) => {
	// Hooks.
	const newProjectWizardState = useNewProjectWizardState(props);

	// Render.
	return (
		<NewProjectWizardContext.Provider value={newProjectWizardState}>
			{props.children}
		</NewProjectWizardContext.Provider>
	);
};

/**
 * Export useNewProjectWizardContext to simplify using the New Project Wizard context object.
 */
export const useNewProjectWizardContext = () => {
	const wizardState = useContext(NewProjectWizardContext);
	if (!wizardState) {
		throw new Error('No new project wizard context provided');
	}
	return wizardState;
};
