/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { ProjectNameLocationStep } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/projectNameLocationStep';
import { PythonEnvironmentStep } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/pythonEnvironmentStep';
import { ProjectTypeStep } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/projectTypeStep';
import { RConfigurationStep } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/rConfigurationStep';

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
	[NewProjectWizardStep.RConfiguration]: RConfigurationStep
};
