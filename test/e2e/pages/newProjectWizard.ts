/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

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
export enum WizardButton {
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
export class NewProjectWizard {
	pythonConfigurationStep: ProjectWizardPythonConfigurationStep;
	currentOrNewWindowSelectionModal: CurrentOrNewWindowSelectionModal;

	private backButton = this.code.driver.page.locator('div.left-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]');
	private cancelButton = this.code.driver.page.locator('div.right-actions > button.positron-button.button.action-bar-button[tabindex="0"][role="button"]');
	private nextButton = this.code.driver.page.locator(PROJECT_WIZARD_DEFAULT_BUTTON).getByText('Next');
	private createButton = this.code.driver.page.locator(PROJECT_WIZARD_DEFAULT_BUTTON).getByText('Create');
	private projectNameInput = this.code.driver.page.getByLabel(/Enter a name for your new/);

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.pythonConfigurationStep = new ProjectWizardPythonConfigurationStep(this.code);
		this.currentOrNewWindowSelectionModal = new CurrentOrNewWindowSelectionModal(this.code);
	}

	async createNewProject({ type, title, rEnvCheckbox, pythonEnv, initAsGitRepo, ipykernelFeedbackExpected }: CreateProjectOptions) {
		await this.quickaccess.runCommand(
			'positron.workbench.action.newProject',
			{ keepOpen: false }
		);

		await this.setProjectType(type);
		await this.setProjectNameLocation(title, initAsGitRepo);
		await this.setProjectConfiguration(type, rEnvCheckbox, pythonEnv, ipykernelFeedbackExpected);

		await this.code.driver.page.getByRole('button', { name: 'Current Window' }).click();
		await expect(this.code.driver.page.locator('.simple-title-bar').filter({ hasText: 'Create New Project' })).not.toBeVisible();
	}

	async setProjectType(projectType: ProjectType) {
		this.code.driver.page.locator('label').filter({ hasText: projectType }).click({ force: true });
		await this.clickWizardButton(WizardButton.NEXT);
	}

	async setProjectNameLocation(projectTitle: string, initAsGitRepo = false) {
		await this.projectNameInput.fill(projectTitle);
		if (initAsGitRepo) {
			await this.code.driver.page.getByText('Initialize project as Git').check();
		}

		await this.clickWizardButton(WizardButton.NEXT);
	}

	async setProjectConfiguration(projectType: ProjectType, rEnvCheckbox = false, pythonEnv: 'Conda' | 'Venv' | 'Existing' = 'Venv', ipyKernelFeedbackExpected = false) {
		if (projectType === ProjectType.R_PROJECT && rEnvCheckbox) {
			await this.code.driver.page.getByText('Use `renv` to create a').click();
		} else if (projectType === ProjectType.PYTHON_PROJECT && pythonEnv === 'Conda') {
			await this.pythonConfigurationStep.selectEnvProvider('Conda');
			// await this.pythonConfigurationStep.selectInterpreterByPath('C:\\Users\\user\\.conda\\envs\\base\\python.exe');
		} else if (projectType === ProjectType.PYTHON_PROJECT && pythonEnv === 'Existing') {
			await this.pythonConfigurationStep.existingEnvRadioButton.click();
			if (ipyKernelFeedbackExpected) {
				await expect(this.code.driver.page.getByText('ipykernel will be installed')).toBeVisible();
			}
			else {
				await expect(this.code.driver.page.getByText('ipykernel will be installed')).not.toBeVisible();
			}
		}
		await this.clickWizardButton(WizardButton.CREATE);
	}

	/**
	 * Clicks the specified navigation button in the project wizard.
	 * @param action The navigation action to take in the project wizard.
	 */
	async clickWizardButton(action: WizardButton) {
		const buttonMap: Record<WizardButton, () => Promise<void>> = {
			[WizardButton.BACK]: () => this.backButton.click(),
			[WizardButton.NEXT]: () => this.nextButton.click(),
			[WizardButton.CANCEL]: () => this.cancelButton.click(),
			[WizardButton.CREATE]: () => this.createButton.click(),
		};

		const clickAction = buttonMap[action];
		if (!clickAction) {
			throw new Error(`Invalid project wizard navigation action: ${action}`);
		}

		await clickAction();
	}
}


class ProjectWizardPythonConfigurationStep {
	existingEnvRadioButton = this.code.driver.page.locator(
		'div[id="wizard-step-set-up-python-environment"] div[id="wizard-sub-step-pythonenvironment-howtosetupenv"] .radio-button-input[id="existingEnvironment"]'
	);
	envProviderDropdown = this.code.driver.page.locator(
		'div[id="wizard-sub-step-python-environment"] .wizard-sub-step-input button.drop-down-list-box'
	);
	interpreterFeedback = this.code.driver.page.locator(
		'div[id="wizard-sub-step-python-interpreter"] .wizard-sub-step-feedback .wizard-formatted-text'
	);
	interpreterDropdown = this.code.driver.page.locator(
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
					.page.locator(
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
			await expect(this.code.driver.page.locator(PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS).first()).toBeVisible();
			await this.code.driver
				.page.locator(
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
		console.log('path', interpreterPath);
		await this.waitForDataLoading();

		try {
			const preselected =
				(await this.code.driver
					.page.locator(
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

		// Open the interpreter dropdown.
		await this.interpreterDropdown.click();

		// Try to find the interpreterPath in the dropdown and click the entry if found
		try {
			await expect(this.code.driver.page.locator(PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS)).toBeVisible();
		} catch (error) {
			throw new Error(
				`Wait for element ${PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS} failed: ${error}`
			);
		}

		// Get all the dropdown entry subtitles and build a comma-separated string of them for
		// logging purposes.
		const dropdownEntrySubtitleLocators = await this.code.driver
			.page.locator(
				`${PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS} div.dropdown-entry-subtitle`
			).all();
		const dropdownEntrySubtitles = dropdownEntrySubtitleLocators.map
			(async (locator) => await locator.innerText());
		const subtitles = (await Promise.all(dropdownEntrySubtitles)).join(', ');

		// Find the dropdown item with the interpreterPath.
		const dropdownItem = this.code.driver
			.page.locator(`${PROJECT_WIZARD_DROPDOWN_POPUP_ITEMS} div.dropdown-entry-subtitle`)
			.getByText(interpreterPath);

		// There should be one dropdown item with the interpreterPath.
		if ((await dropdownItem.count()) !== 1) {
			// Close the interpreter dropdown.
			await this.code.driver.page.keyboard.press('Escape');

			// Fail the test.
			fail(`Could not find interpreter path ("${interpreterPath}") in ("${subtitles}") project wizard dropdown`);
		}

		// Click the interpreter.
		await dropdownItem.click();
	}
}

class CurrentOrNewWindowSelectionModal {
	currentWindowButton = this.code.driver
		.page.locator(
			'button.positron-button.button.action-bar-button[tabindex="0"][role="button"]'
		)
		.getByText('Current Window');

	constructor(private code: Code) { }
}

export interface CreateProjectOptions {
	type: ProjectType;
	title: string;
	rEnvCheckbox?: boolean;
	pythonEnv?: 'Conda' | 'Venv' | 'Existing';
	initAsGitRepo?: boolean;
	ipykernelFeedbackExpected?: boolean;
}
