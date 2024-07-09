/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { PositronBaseElement } from './positronBaseElement';

const PROJECT_WIZARD_NEW_PYTHON_PROJECT = '[id="Python Project"]';
const PROJECT_WIZARD_NEW_R_PROJECT = '[id="R Project"]';
const PROJECT_WIZARD_CANCEL_BUTTON = 'div.right-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]';
const PROJECT_WIZARD_NEXT_BUTTON = 'button.positron-button.button.action-bar-button.default[tabindex="0"][role="button"]';
const PROJECT_WIZARD_BACK_BUTTON = 'div.left-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]';
const PROJECT_WIZARD_DISABLED_CREATE_BUTTON = 'button.positron-button.button.action-bar-button.default.disabled[tabindex="0"][disabled][role="button"][aria-disabled="true"]';
const PROJECT_WIZARD_CURRENT_WINDOW_BUTTON = 'button.positron-button.button.action-bar-button[tabindex="0"][role="button"]';
const PROJECT_WIZARD_NEW_JUPYTER_PROJECT = '[id="Jupyter Notebook"]';
const PROJECT_WIZARD_RENV_CHECKBOX = 'div.renv-configuration > div.checkbox';
const PROJECT_WIZARD_PROJECT_NAME_INPUT = 'div.wizard-sub-step-input input.text-input';

/*
 *  Reuseable Positron new project wizard functionality for tests to leverage.
 */
export class PositronNewProjectWizard {
	newPythonProjectButton: PositronBaseElement;
	newRProjectButton: PositronBaseElement;
	projectWizardCancelButton: PositronBaseElement;
	projectWizardNextButton: PositronBaseElement;
	projectWizardBackButton: PositronBaseElement;
	projectWizardDisabledCreateButton: PositronBaseElement;
	projectWizardCurrentWindowButton: PositronBaseElement;
	newJupyterProjectButton: PositronBaseElement;
	projectWizardRenvCheckbox: PositronBaseElement;
	projectWizardProjectNameInput: PositronBaseElement;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.newPythonProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_PYTHON_PROJECT, this.code);
		this.newRProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_R_PROJECT, this.code);
		this.projectWizardCancelButton = new PositronBaseElement(PROJECT_WIZARD_CANCEL_BUTTON, this.code);
		this.projectWizardNextButton = new PositronBaseElement(PROJECT_WIZARD_NEXT_BUTTON, this.code);
		this.projectWizardBackButton = new PositronBaseElement(PROJECT_WIZARD_BACK_BUTTON, this.code);
		this.projectWizardDisabledCreateButton = new PositronBaseElement(PROJECT_WIZARD_DISABLED_CREATE_BUTTON, this.code);
		this.projectWizardCurrentWindowButton = new PositronBaseElement(PROJECT_WIZARD_CURRENT_WINDOW_BUTTON, this.code);
		this.newJupyterProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_JUPYTER_PROJECT, this.code);
		this.projectWizardRenvCheckbox = new PositronBaseElement(PROJECT_WIZARD_RENV_CHECKBOX, this.code);
		this.projectWizardProjectNameInput = new PositronBaseElement(PROJECT_WIZARD_PROJECT_NAME_INPUT, this.code);
	}

	async startNewProject() {
		await this.quickaccess.runCommand('positron.workbench.action.newProject', { keepOpen: false });
	}

	async appendToProjectName(text: string) {
		await this.code.waitForActiveElement(PROJECT_WIZARD_PROJECT_NAME_INPUT);
		await this.projectWizardProjectNameInput.getPage().keyboard.type(text);
	}
}
