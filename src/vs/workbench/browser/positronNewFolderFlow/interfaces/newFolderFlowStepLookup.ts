/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NewFolderFlowStep } from './newFolderFlowEnums.js';
import { FolderTemplateStep } from '../components/steps/folderTemplateStep.js';
import { RConfigurationStep } from '../components/steps/rConfigurationStep.js';
import { PythonEnvironmentStep } from '../components/steps/pythonEnvironmentStep.js';
import { FolderNameLocationStep } from '../components/steps/folderNameLocationStep.js';

/**
 * The NewFolderFlowStepLookup object is like a map of NewFolderFlowStep to the
 * component that should be rendered for that step.
 *
 * Add new steps to this object using the NewFolderFlowStep enum as the key
 * and the component as the value.
 */
export const NewFolderFlowStepLookup = {
	[NewFolderFlowStep.None]: () => null,
	[NewFolderFlowStep.FolderTemplateSelection]: FolderTemplateStep,
	[NewFolderFlowStep.FolderNameLocation]: FolderNameLocationStep,
	[NewFolderFlowStep.PythonEnvironment]: PythonEnvironmentStep,
	[NewFolderFlowStep.RConfiguration]: RConfigurationStep
};
