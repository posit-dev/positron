/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * The NewProjectWizardStep enum is a list of steps in the New Project Wizard.
 * Each step corresponds to a component that should be rendered for that step.
 *
 * New steps can be added to this enum as needed.
 */
export enum NewProjectWizardStep {
	None = 'none',
	ProjectTypeSelection = 'projectTypeSelectionStep',
	ProjectNameLocation = 'projectNameLocation',
	PythonEnvironment = 'pythonEnvironment',
}

/**
 * The EnvironmentSetupType enum includes the types of environment setup options.
 * - NewEnvironment: Create a new environment.
 * - ExistingEnvironment: Use an existing environment.
 */
export enum EnvironmentSetupType {
	NewEnvironment = 'newEnvironment',
	ExistingEnvironment = 'existingEnvironment'
}
