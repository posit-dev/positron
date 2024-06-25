/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';

/**
 * The NewProjectWizardStepProps interface provides the wizard navigation functions
 * to the New Project Wizard steps.
 */
export interface NewProjectWizardStepProps {
	cancel: () => void;
	accept: () => void;
	next: (step: NewProjectWizardStep) => void;
	back: () => void;
}
