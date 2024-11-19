/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NewProjectWizardStep } from './newProjectWizardEnums.js';
import { ProjectNameLocationStep } from '../components/steps/projectNameLocationStep.js';
import { PythonEnvironmentStep } from '../components/steps/pythonEnvironmentStep.js';
import { ProjectTypeStep } from '../components/steps/projectTypeStep.js';
import { RConfigurationStep } from '../components/steps/rConfigurationStep.js';

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
