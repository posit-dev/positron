/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ProjectNameLocationStep } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/projectNameLocationStep';
import { ProjectTypeSelectionStep } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/projectTypeSelectionStep';

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
}

/**
 * The NewProjectWizardSteps object is a map of NewProjectWizardStep to the
 * component that should be rendered for that step.
 *
 * Add new steps to this object using the NewProjectWizardStep enum as the key
 * and the component as the value.
 */
export const NewProjectWizardSteps = {
	[NewProjectWizardStep.None]: () => null,
	[NewProjectWizardStep.ProjectTypeSelection]: ProjectTypeSelectionStep,
	[NewProjectWizardStep.ProjectNameLocation]: ProjectNameLocationStep,
};

/**
 * The NewProjectWizardStepStack class is a stack of NewProjectWizardSteps.
 */
export class NewProjectWizardStepStack {
	/**
	 * The steps in the stack.
	 */
	steps: NewProjectWizardStep[];

	/**
	 * Create a new NewProjectWizardStepStack.
	 * @param initialStep The initial step to add to the stack.
	 */
	constructor(initialStep?: NewProjectWizardStep) {
		this.steps = [];
		if (initialStep) {
			this.push(initialStep);
		}
	}

	/**
	 * Push a new step onto the stack.
	 * @param step The step to add to the stack.
	 */
	private push(step: NewProjectWizardStep) {
		this.steps.push(step);
	}

	/**
	 * Pop a step from the stack.
	 * @returns The step that was popped from the stack.
	 */
	private pop() {
		return this.steps.pop();
	}

	/**
	 * Get the current step.
	 * @returns The current step.
	 */
	get currentStep(): NewProjectWizardStep {
		if (this.steps.length === 0) {
			return NewProjectWizardStep.None;
		}
		return this.steps[this.steps.length - 1];
	}

	/**
	 * Go to the next step. Adds the next step to the stack.
	 * @param step The next step to go to.
	 */
	goToNextStep(step: NewProjectWizardStep) {
		this.push(step);
	}

	/**
	 * Go to the previous step. Removes the current step from the stack
	 * and returns the previous step.
	 * @returns The previous step.
	 */
	goToPreviousStep(): NewProjectWizardStep {
		this.pop();
		return this.currentStep;
	}
}
