/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { PositronBaseElement } from './positronBaseElement';

const PROJECT_WIZARD_NEW_PYTHON_PROJECT = '#Python Project';
const PROJECT_WIZARD_CANCEL_BUTTON = '.positron-modal-dailog-box.positron-button.button.action-bar-button';

export class PositronNewProjectWizard {
	newPythonProjectButton: PositronBaseElement;
	projectWizardCancelButton: PositronBaseElement;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.newPythonProjectButton = new PositronBaseElement(PROJECT_WIZARD_NEW_PYTHON_PROJECT, this.code);
		this.projectWizardCancelButton = new PositronBaseElement(PROJECT_WIZARD_CANCEL_BUTTON, this.code);
	}

	async startNewProject() {
		await this.quickaccess.runCommand('positron.workbench.action.newProject', { keepOpen: false });
	}
}
