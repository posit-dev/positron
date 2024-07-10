/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { PositronBaseElement } from './positronBaseElement';

// Project Wizard General Modal Elements
const PROJECT_WIZARD_CANCEL_BUTTON = 'div.right-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]';
const PROJECT_WIZARD_NEXT_BUTTON = 'button.positron-button.button.action-bar-button.default[tabindex="0"][role="button"]';
const PROJECT_WIZARD_BACK_BUTTON = 'div.left-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]';

// Project Type Selection Step
const PROJECT_WIZARD_NEW_PYTHON_PROJECT = '[id="Python Project"]';
const PROJECT_WIZARD_NEW_R_PROJECT = '[id="R Project"]';
const PROJECT_WIZARD_NEW_JUPYTER_PROJECT = '[id="Jupyter Notebook"]';

// Project Name & Location Step
const PROJECT_WIZARD_PROJECT_NAME_INPUT = 'div.wizard-sub-step-input input.text-input';

// Configuration Step: General
const PROJECT_WIZARD_DISABLED_CREATE_BUTTON = 'button.positron-button.button.action-bar-button.default.disabled[tabindex="0"][disabled][role="button"][aria-disabled="true"]';

// Configuration Step: Python Project & Jupyter Notebook
const PROJECT_WIZARD_EXISTING_ENV_RADIO_BUTTON = '.radio-button-input[id="existingEnvironment"]';
const PROJECT_WIZARD_NEW_ENV_RADIO_BUTTON = 'radio-button-input.[id="newEnvironment"]';

// Configuration Step: R Project
const PROJECT_WIZARD_RENV_CHECKBOX = 'div.renv-configuration > div.checkbox';

// Current or New Window Selection Modal
const PROJECT_WIZARD_CURRENT_WINDOW_BUTTON = 'button.positron-button.button.action-bar-button[tabindex="0"][role="button"]';

/*
 *  Reuseable Positron new project wizard functionality for tests to leverage.
 */
export class PositronNewProjectWizard {
	projectTypeStep: ProjectWizardProjectTypeStep;
	projectNameLocationStep: ProjectWizardProjectNameLocationStep;
	rConfigurationStep: ProjectWizardRConfigurationStep;
	pythonConfigurationStep: ProjectWizardPythonConfigurationStep;
	currentOrNewWindowSelectionModal: CurrentOrNewWindowSelectionModal;

	cancelButton: PositronBaseElement;
	nextButton: PositronBaseElement;
	backButton: PositronBaseElement;
	disabledCreateButton: PositronBaseElement;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.projectTypeStep = new ProjectWizardProjectTypeStep(this.code);
		this.projectNameLocationStep = new ProjectWizardProjectNameLocationStep(this.code);
		this.rConfigurationStep = new ProjectWizardRConfigurationStep(this.code);
		this.pythonConfigurationStep = new ProjectWizardPythonConfigurationStep(this.code);
		this.currentOrNewWindowSelectionModal = new CurrentOrNewWindowSelectionModal(this.code);

		this.cancelButton = new PositronBaseElement(PROJECT_WIZARD_CANCEL_BUTTON, this.code);
		this.nextButton = new PositronBaseElement(PROJECT_WIZARD_NEXT_BUTTON, this.code);
		this.backButton = new PositronBaseElement(PROJECT_WIZARD_BACK_BUTTON, this.code);
		this.disabledCreateButton = new PositronBaseElement(PROJECT_WIZARD_DISABLED_CREATE_BUTTON, this.code);
	}

	async startNewProject() {
		await this.quickaccess.runCommand('positron.workbench.action.newProject', { keepOpen: false });
	}
}

class ProjectWizardProjectTypeStep {
	pythonProjectButton: PositronBaseElement;
	rProjectButton: PositronBaseElement;
	jupyterNotebookButton: PositronBaseElement;

	constructor(private code: Code) {
		this.pythonProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_PYTHON_PROJECT, this.code);
		this.rProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_R_PROJECT, this.code);
		this.jupyterNotebookButton = new PositronBaseElement(PROJECT_WIZARD_NEW_JUPYTER_PROJECT, this.code);
	}
}

class ProjectWizardProjectNameLocationStep {
	projectNameInput: PositronBaseElement;

	constructor(private code: Code) {
		this.projectNameInput = new PositronBaseElement(PROJECT_WIZARD_PROJECT_NAME_INPUT, this.code);
	}

	async appendToProjectName(text: string) {
		await this.code.waitForActiveElement(PROJECT_WIZARD_PROJECT_NAME_INPUT);
		await this.projectNameInput.getPage().keyboard.type(text);
	}
}

class ProjectWizardRConfigurationStep {
	renvCheckbox: PositronBaseElement;

	constructor(private code: Code) {
		this.renvCheckbox = new PositronBaseElement(PROJECT_WIZARD_RENV_CHECKBOX, this.code);
	}
}

class ProjectWizardPythonConfigurationStep {
	newEnvRadioButton: PositronBaseElement;
	existingEnvRadioButton: PositronBaseElement;
	// TO ADD:
	// env provider selection
	// interpreter selection
	// interpreter feedback text
	constructor(private code: Code) {
		this.newEnvRadioButton = new PositronBaseElement(PROJECT_WIZARD_NEW_ENV_RADIO_BUTTON, this.code);
		this.existingEnvRadioButton = new PositronBaseElement(PROJECT_WIZARD_EXISTING_ENV_RADIO_BUTTON, this.code);
	}
}

class CurrentOrNewWindowSelectionModal {
	currentWindowButton: PositronBaseElement;

	constructor(private code: Code) {
		this.currentWindowButton = new PositronBaseElement(PROJECT_WIZARD_CURRENT_WINDOW_BUTTON, this.code);
	}
}
