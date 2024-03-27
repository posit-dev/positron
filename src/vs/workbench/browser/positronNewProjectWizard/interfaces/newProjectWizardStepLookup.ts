/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStep';
import { ProjectNameLocationStep } from 'vs/workbench/browser/positronNewProjectWizard/steps/projectNameLocationStep';
import { PythonEnvironmentStep } from 'vs/workbench/browser/positronNewProjectWizard/steps/pythonEnvironmentStep';
import { ProjectTypeStep } from 'vs/workbench/browser/positronNewProjectWizard/steps/projectTypeStep';

/**
 * The NewProjectWizardStepLookup object is like a map of NewProjectWizardStep to the
 * component that should be rendered for that step.
 *
 * Add new steps to this object using the NewProjectWizardStep enum as the key
 * and the component as the value.
 */
export const NewProjectWizardStepLookup = {
	[NewProjectWizardStep.None]: () => null,
	[NewProjectWizardStep.ProjectTypeSelection]: ProjectTypeStep,
	[NewProjectWizardStep.ProjectNameLocation]: ProjectNameLocationStep,
	[NewProjectWizardStep.PythonEnvironment]: PythonEnvironmentStep,
};
