/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStep';

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
