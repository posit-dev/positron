/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export class NewProjectWizard {
	private backButton = this.code.driver.page.getByRole('button', { name: 'Back', exact: true });
	private cancelButton = this.code.driver.page.getByRole('button', { name: 'Cancel' });
	private nextButton = this.code.driver.page.getByRole('button', { name: 'Next', exact: true });
	private createButton = this.code.driver.page.getByRole('button', { name: 'Create', exact: true });
	private projectNameInput = this.code.driver.page.getByLabel(/Enter a name for your new/);
	private existingEnvRadioButton = this.code.driver.page.getByText(/Use an existing/);
	private envProviderDropdown = this.code.driver.page.locator('#wizard-sub-step-python-environment').locator('button');
	private envProviderDropdownTitle = this.envProviderDropdown.locator('.dropdown-entry-title');
	private dropDropdownOptions = this.code.driver.page.locator('.positron-modal-popup-children').getByRole('button');
	private interpreterDropdown = this.code.driver.page.locator('#wizard-sub-step-python-interpreter').locator('button');
	private interpreterDropdownSubtitle = this.interpreterDropdown.locator('.dropdown-entry-subtitle');

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	/**
	 * NEW PROJECT WIZARD:
	 * Step through the new project wizard in order to create a new project.
	 * @param options The options to configure the new project.
	 */
	async createNewProject(options: CreateProjectOptions) {
		await this.quickaccess.runCommand('positron.workbench.action.newProject', { keepOpen: false });

		await this.setProjectType(options.type);
		await this.setProjectNameLocation(options);
		await this.setProjectConfiguration(options);

		await this.code.driver.page.getByRole('button', { name: 'Current Window' }).click();
		await expect(this.code.driver.page.locator('.simple-title-bar').filter({ hasText: 'Create New Project' })).not.toBeVisible();
	}

	/**
	 * Step 1. Select the project type in the project wizard.
	 * @param projectType The project type to select.
	 */
	async setProjectType(projectType: ProjectType) {
		this.code.driver.page.locator('label').filter({ hasText: projectType }).click({ force: true });
		await this.clickWizardButton(WizardButton.NEXT);
	}

	/**
	 * Step 2. Set the project name and location in the project wizard.
	 * @param projectTitle The title to set for the project.
	 * @param initAsGitRepo Whether to initialize the project as a Git repository
	 **/
	async setProjectNameLocation(options: CreateProjectOptions) {
		const { title: projectTitle, initAsGitRepo } = options;

		await this.projectNameInput.fill(projectTitle);
		if (initAsGitRepo) {
			await this.code.driver.page.getByText('Initialize project as Git').check();
		}

		await this.clickWizardButton(WizardButton.NEXT);
	}

	/**
	 * Step 3. Set the project configuration in the project wizard.
	 * @param options The options to configure the project.
	 */
	async setProjectConfiguration(options: CreateProjectOptions) {
		const { type, rEnvCheckbox, pythonEnv, ipykernelFeedbackExpected } = options;

		// configure R Project
		if (type === ProjectType.R_PROJECT && rEnvCheckbox) {
			await this.code.driver.page.getByText('Use `renv` to create a').click();
		}

		// configure Python Project
		if (type === ProjectType.PYTHON_PROJECT) {
			if (pythonEnv === 'Conda') {
				await this.selectEnvProvider('Conda');
			} else if (pythonEnv === 'Existing') {
				await this.existingEnvRadioButton.click();
				const ipykernelMessage = this.code.driver.page.getByText('ipykernel will be installed');
				ipykernelFeedbackExpected
					? await expect(ipykernelMessage).toBeVisible()
					: await expect(ipykernelMessage).not.toBeVisible();
			}
		}

		await this.clickWizardButton(WizardButton.CREATE);
	}

	/**
	 * Helper: Clicks the specified navigation button in the project wizard.
	 * @param action The navigation action to take in the project wizard.
	 */
	async clickWizardButton(action: WizardButton) {
		const button = {
			[WizardButton.BACK]: this.backButton,
			[WizardButton.NEXT]: this.nextButton,
			[WizardButton.CANCEL]: this.cancelButton,
			[WizardButton.CREATE]: this.createButton,
		}[action];

		if (!button) {
			throw new Error(`Invalid wizard button action: ${action}`);
		}

		await button.click();
	}

	/**
	 * Helper: Selects the specified environment provider in the project wizard environment provider dropdown.
	 * @param providerToSelect The environment provider to select.
	 */
	async selectEnvProvider(providerToSelect: string) {
		// Wait for loading to finish
		await expect(this.code.driver.page.getByText(/Loading/)).toHaveCount(0, { timeout: 30000 });

		// Skip if the desired provider is already selected
		if (await this.envProviderDropdownTitle.innerText() === providerToSelect) {
			return;
		}

		// Select the desired provider from the dropdown
		await this.envProviderDropdown.click();
		await this.dropDropdownOptions.filter({ hasText: providerToSelect }).click();
	}

	/**
	 * Helper: Selects the interpreter corresponding to the given path in the project wizard interpreter dropdown.
	 * @param interpreterPath The path of the interpreter to select in the dropdown.
	 */
	async selectInterpreterByPath(interpreterPath: string) {
		// Wait for loading to complete
		await expect(this.code.driver.page.getByText(/Loading/)).toHaveCount(0, { timeout: 30000 });

		// Skip if the desired interpreter is already selected
		if (await this.interpreterDropdownSubtitle.innerText() === interpreterPath) {
			return;
		}

		// Open the dropdown and select the interpreter by path
		await this.interpreterDropdown.click();
		await this.dropDropdownOptions
			.locator('div.dropdown-entry-subtitle')
			.getByText(interpreterPath)
			.first()
			.click();
	}
}

export interface CreateProjectOptions {
	type: ProjectType;
	title: string;
	rEnvCheckbox?: boolean;
	pythonEnv?: 'Conda' | 'Venv' | 'Existing';
	initAsGitRepo?: boolean;
	ipykernelFeedbackExpected?: boolean;
}

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
