/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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

export class PositronNewProjectWizard {
	newPythonProjectButton: PositronBaseElement;
	newRProjectButton: PositronBaseElement;
	projectWizardCancelButton: PositronBaseElement;
	projectWizardNextButton: PositronBaseElement;
	projectWizardBackButton: PositronBaseElement;
	projectWizardDisabledCreateButton: PositronBaseElement;
	projectWizardCurrentWindowButton: PositronBaseElement;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.newPythonProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_PYTHON_PROJECT, this.code);
		this.newRProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_R_PROJECT, this.code);
		this.projectWizardCancelButton = new PositronBaseElement(PROJECT_WIZARD_CANCEL_BUTTON, this.code);
		this.projectWizardNextButton = new PositronBaseElement(PROJECT_WIZARD_NEXT_BUTTON, this.code);
		this.projectWizardBackButton = new PositronBaseElement(PROJECT_WIZARD_BACK_BUTTON, this.code);
		this.projectWizardDisabledCreateButton = new PositronBaseElement(PROJECT_WIZARD_DISABLED_CREATE_BUTTON, this.code);
		this.projectWizardCurrentWindowButton = new PositronBaseElement(PROJECT_WIZARD_CURRENT_WINDOW_BUTTON, this.code);
	}

	async startNewProject() {
		await this.quickaccess.runCommand('positron.workbench.action.newProject', { keepOpen: false });
	}
}
