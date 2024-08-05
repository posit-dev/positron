/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../code';
import { QuickAccess } from '../quickaccess';

// Selector for the pre-selected dropdown item in the project wizard
const PROJECT_WIZARD_PRESELECTED_DROPDOWN_ITEM =
	'button.drop-down-list-box div.title';

// Selector for the currently open dropdown popup items in the project wizard
const PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS =
	'div.positron-modal-popup-children button.positron-button.item';

// Selector for the default button in the project wizard, which will either be 'Next' or 'Create'
const PROJECT_WIZARD_DEFAULT_BUTTON = 'button.positron-button.button.action-bar-button.default[tabindex="0"][role="button"]';

/**
 * Enum representing the possible navigation actions that can be taken in the project wizard.
 */
export enum ProjectWizardNavigateAction {
	BACK,
	NEXT,
	CANCEL,
	CREATE,
}

/**
 * Enum representing the possible project types that can be selected in the project wizard.
 */
export enum ProjectType {
	PYTHON_PROJECT = 'Python Project',
	R_PROJECT = 'R Project',
	JUPYTER_NOTEBOOK = 'Jupyter Notebook',
}

/*
 *  Reuseable Positron new project wizard functionality for tests to leverage.
 */
export class PositronNewProjectWizard {
	projectTypeStep: ProjectWizardProjectTypeStep;
	projectNameLocationStep: ProjectWizardProjectNameLocationStep;
	rConfigurationStep: ProjectWizardRConfigurationStep;
	pythonConfigurationStep: ProjectWizardPythonConfigurationStep;
	currentOrNewWindowSelectionModal: CurrentOrNewWindowSelectionModal;

	private backButton = this.code.driver.getLocator('div.left-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]');
	private cancelButton = this.code.driver.getLocator('div.right-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]');
	private nextButton = this.code.driver.getLocator(PROJECT_WIZARD_DEFAULT_BUTTON).getByText('Next');
	private createButton = this.code.driver.getLocator(PROJECT_WIZARD_DEFAULT_BUTTON).getByText('Create');

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.projectTypeStep = new ProjectWizardProjectTypeStep(this.code);
		this.projectNameLocationStep = new ProjectWizardProjectNameLocationStep(this.code);
		this.rConfigurationStep = new ProjectWizardRConfigurationStep(this.code);
		this.pythonConfigurationStep = new ProjectWizardPythonConfigurationStep(this.code);
		this.currentOrNewWindowSelectionModal = new CurrentOrNewWindowSelectionModal(this.code);
	}

	/**
	 * Starts a new project of the specified type in the project wizard.
	 * @param projectType The type of project to select.
	 * @returns A promise that resolves once the project wizard is open and the project type is selected.
	 */
	async startNewProject(projectType: ProjectType) {
		await this.quickaccess.runCommand(
			'positron.workbench.action.newProject',
			{ keepOpen: false }
		);
		// Select the specified project type in the project wizard
		await this.projectTypeStep.selectProjectType(projectType);
	}

	/**
	 * Clicks the specified navigation button in the project wizard.
	 * @param action The navigation action to take in the project wizard.
	 */
	async navigate(action: ProjectWizardNavigateAction) {
		switch (action) {
			case ProjectWizardNavigateAction.BACK:
				await this.backButton.waitFor();
				await this.backButton.click();
				break;
			case ProjectWizardNavigateAction.NEXT:
				await this.nextButton.waitFor();
				await this.nextButton.isEnabled({ timeout: 5000 });
				await this.nextButton.click();
				break;
			case ProjectWizardNavigateAction.CANCEL:
				await this.cancelButton.waitFor();
				await this.cancelButton.click();
				break;
			case ProjectWizardNavigateAction.CREATE:
				await this.createButton.waitFor();
				await this.createButton.isEnabled({ timeout: 5000 });
				await this.createButton.click();
				break;
			default:
				throw new Error(
					`Invalid project wizard navigation action: ${action}`
				);
		}
	}
}

class ProjectWizardProjectTypeStep {
	constructor(private code: Code) { }

	async selectProjectType(projectType: ProjectType) {
		await this.code.waitAndClick(`input[id="${projectType}"]`);
	}
}

class ProjectWizardProjectNameLocationStep {
	projectNameInput = this.code.driver.getLocator(
		'div[id="wizard-sub-step-project-name"] .wizard-sub-step-input input.text-input'
	);
	projectOptionCheckboxes = this.code.driver.getLocator(
		'div[id="wizard-sub-step-misc-proj-options"] div.checkbox'
	);
	gitInitCheckbox = this.projectOptionCheckboxes.getByText(
		'Initialize project as Git repository'
	);

	constructor(private code: Code) { }

	async appendToProjectName(text: string) {
		await this.projectNameInput.waitFor();
		await this.projectNameInput.page().keyboard.type(text);
	}
}

class ProjectWizardRConfigurationStep {
	renvCheckbox = this.code.driver.getLocator(
		'div.renv-configuration > div.checkbox'
	);

	constructor(private code: Code) { }
}

class ProjectWizardPythonConfigurationStep {
	existingEnvRadioButton = this.code.driver.getLocator(
		'div[id="wizard-step-set-up-python-environment"] div[id="wizard-sub-step-pythonenvironment-howtosetupenv"] .radio-button-input[id="existingEnvironment"]'
	);
	envProviderDropdown = this.code.driver.getLocator(
		'div[id="wizard-sub-step-python-environment"] .wizard-sub-step-input button.drop-down-list-box'
	);
	interpreterFeedback = this.code.driver.getLocator(
		'div[id="wizard-sub-step-python-interpreter"] .wizard-sub-step-feedback .wizard-formatted-text'
	);
	interpreterDropdown = this.code.driver.getLocator(
		'div[id="wizard-sub-step-python-interpreter"] .wizard-sub-step-input button.drop-down-list-box'
	);

	constructor(private code: Code) { }

	private async waitForDataLoading() {
		// The env provider dropdown is only visible when New Environment is selected
		if (await this.envProviderDropdown.isVisible()) {
			await expect(this.envProviderDropdown).not.toContainText(
				'Loading environment providers...',
				{ timeout: 5000 }
			);
		}

		// The interpreter dropdown is always visible
		await expect(this.interpreterDropdown).not.toContainText(
			'Loading interpreters...',
			{ timeout: 5000 }
		);
	}

	/**
	 * Selects the specified environment provider in the project wizard environment provider dropdown.
	 * @param provider The environment provider to select.
	 */
	async selectEnvProvider(provider: string) {
		await this.waitForDataLoading();

		try {
			const preselected =
				(await this.code.driver
					.getLocator(
						`${PROJECT_WIZARD_PRESELECTED_DROPDOWN_ITEM} div.dropdown-entry-title`
					)
					.getByText(provider)
					.count()) === 1;
			if (preselected) {
				return;
			}
		} catch (error) {
			// The env provider isn't pre-selected in the dropdown, so let's try to find it by clicking
			// the dropdown and then clicking the env provider
			this.code.logger.log(
				`Environment provider '${provider}' is not pre-selected in the Project Wizard environment provider dropdown.`
			);
		}

		// Open the dropdown
		await this.envProviderDropdown.click();

		// Try to find the env provider in the dropdown
		try {
			await this.code.waitForElement(PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS);
			await this.code.driver
				.getLocator(
					`${PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS} div.dropdown-entry-title`
				)
				.getByText(provider)
				.click();
			return;
		} catch (error) {
			throw new Error(
				`Could not find env provider in project wizard dropdown: ${error}`
			);
		}
	}

	/**
	 * Selects the interpreter corresponding to the given path in the project wizard interpreter
	 * dropdown.
	 * @param interpreterPath The path of the interpreter to select in the dropdown.
	 * @returns A promise that resolves once the interpreter is selected, or rejects if the interpreter is not found.
	 */
	async selectInterpreterByPath(interpreterPath: string) {
		await this.waitForDataLoading();

		try {
			const preselected =
				(await this.code.driver
					.getLocator(
						`${PROJECT_WIZARD_PRESELECTED_DROPDOWN_ITEM} div.dropdown-entry-subtitle`
					)
					.getByText(interpreterPath)
					.count()) === 1;
			if (preselected) {
				return;
			}
		} catch (error) {
			// The interpreter isn't pre-selected in the dropdown, so let's try to find it by clicking
			// the dropdown and then clicking the interpreter
			this.code.logger.log(
				`Interpreter '${interpreterPath}' is not pre-selected in the Project Wizard interpreter dropdown.`
			);
		}

		// Open the dropdowns
		await this.interpreterDropdown.click();

		// Try to find the interpreterPath in the dropdown and click the entry if found
		try {
			await this.code.waitForElement(PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS);
			await this.code.driver
				.getLocator(
					`${PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS} div.dropdown-entry-subtitle`
				)
				.getByText(interpreterPath)
				.click();
			return;
		} catch (error) {
			throw new Error(
				`Could not find interpreter path in project wizard dropdown: ${error}`
			);
		}
	}
}

class CurrentOrNewWindowSelectionModal {
	currentWindowButton = this.code.driver
		.getLocator(
			'button.positron-button.button.action-bar-button[tabindex="0"][role="button"]'
		)
		.getByText('Current Window');

	constructor(private code: Code) { }
}
