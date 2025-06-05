/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export class NewFolderFlow {
	private backButton = this.code.driver.page.getByRole('button', { name: 'Back', exact: true });
	private cancelButton = this.code.driver.page.getByRole('button', { name: 'Cancel' });
	private nextButton = this.code.driver.page.getByRole('button', { name: 'Next', exact: true });
	private createButton = this.code.driver.page.getByRole('button', { name: 'Create', exact: true });
	private folderNameInput = this.code.driver.page.getByLabel(/Enter the name of your new/);
	private existingEnvRadioButton = this.code.driver.page.getByText(/Use an existing/);
	private envProviderDropdown = this.code.driver.page.locator('#flow-sub-step-python-environment').locator('button');
	private envProviderDropdownTitle = this.envProviderDropdown.locator('.dropdown-entry-title');
	private dropDropdownOptions = this.code.driver.page.locator('.positron-modal-popup-children').getByRole('button');
	private interpreterDropdown = this.code.driver.page.locator('#flow-sub-step-python-interpreter').locator('button');
	private interpreterDropdownSubtitle = this.interpreterDropdown.locator('.dropdown-entry-subtitle');

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	/**
	 * NEW FOLDER FLOW:
	 * Step through the New Folder Flow in order to create a new folder.
	 * @param options The options to configure the new folder.
	 */
	async createNewFolder(options: CreateFolderOptions) {
		await this.quickaccess.runCommand('positron.workbench.action.newFolderFromTemplate', { keepOpen: false });

		await this.setFolderTemplate(options.folderTemplate);
		await this.setFolderNameLocation(options);
		await this.setConfiguration(options);

		await this.code.driver.page.getByRole('button', { name: 'Current Window' }).click();
		await expect(this.code.driver.page.locator('.simple-title-bar').filter({ hasText: 'New Folder From Template' })).not.toBeVisible();
	}

	/**
	 * Step 1. Select the folder template in the New Folder Flow.
	 * @param folderTemplate The folder template to select.
	 */
	async setFolderTemplate(folderTemplate: FolderTemplate) {
		await this.code.driver.page.locator('label').filter({ hasText: folderTemplate }).click({ force: true });
		await this.clickFlowButton(FlowButton.NEXT);
	}

	/**
	 * Step 2. Set the folder name and location in the New Folder Flow.
	 * @param folderName The folder name.
	 * @param initGitRepo Whether to initialize a Git repository.
	 **/
	async setFolderNameLocation(options: CreateFolderOptions) {
		const { folderName, initGitRepo } = options;

		await this.folderNameInput.fill(folderName);
		if (initGitRepo) {
			await this.code.driver.page.getByText('Initialize Git repository').check();
		}

		await this.clickFlowButton(FlowButton.NEXT);
	}

	/**
	 * Step 3. Set the configuration in the New Folder Flow.
	 * @param options The options to configure the folder.
	 */
	async setConfiguration(options: CreateFolderOptions) {
		const { folderTemplate: type, rEnvCheckbox, pythonEnv, ipykernelFeedback, interpreterPath, status } = options;

		// configure R Project
		if (type === FolderTemplate.R_PROJECT && rEnvCheckbox) {
			await this.code.driver.page.getByText('Use `renv` to create a').click();
		}

		// configure Python Project
		if (type === FolderTemplate.PYTHON_PROJECT) {
			if (status === 'existing') {
				await this.existingEnvRadioButton.click();
			}

			if (pythonEnv) {
				await this.selectEnvProvider(pythonEnv);
			}

			if (interpreterPath) {
				await this.selectInterpreterByPath(interpreterPath);
			}

			if (ipykernelFeedback) {
				const ipykernelMessage = this.code.driver.page.getByText('ipykernel will be installed');
				ipykernelFeedback === 'show'
					? await expect(ipykernelMessage).toBeVisible()
					: await expect(ipykernelMessage).not.toBeVisible();
			}
		}

		await this.clickFlowButton(FlowButton.CREATE);
	}

	/**
	 * Helper: Clicks the specified navigation button in the new folder flow.
	 * @param action The navigation action to take in the new folder flow.
	 */
	async clickFlowButton(action: FlowButton) {
		const button = {
			[FlowButton.BACK]: this.backButton,
			[FlowButton.NEXT]: this.nextButton,
			[FlowButton.CANCEL]: this.cancelButton,
			[FlowButton.CREATE]: this.createButton,
		}[action];

		if (!button) {
			throw new Error(`Invalid flow button action: ${action}`);
		}

		await button.click();
	}

	/**
	 * Helper: Selects the specified environment provider in the new folder flow environment provider dropdown.
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
	 * Helper: Selects the interpreter corresponding to the given path in the new folder flow interpreter dropdown.
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
		await expect(async () => {

			try {
				await this.interpreterDropdown.click();
				await this.dropDropdownOptions
					.locator('div.dropdown-entry-subtitle')
					.getByText(interpreterPath)
					.first()
					.click({ timeout: 5000 });
			} catch (error) {
				await this.code.driver.page.keyboard.press('Escape');
				throw error;
			}

		}).toPass({ intervals: [1_000, 5_000, 10_000], timeout: 15000 });
	}
}

export interface CreateFolderOptions {
	folderTemplate: FolderTemplate;
	folderName: string;
	status?: 'new' | 'existing';
	rEnvCheckbox?: boolean;
	pythonEnv?: 'conda' | 'venv' | 'uv';
	initGitRepo?: boolean;
	ipykernelFeedback?: 'show' | 'hide';
	interpreterPath?: string;
}

/**
 * Enum representing the possible navigation actions that can be taken in new folder flow.
 */
export enum FlowButton {
	BACK,
	NEXT,
	CANCEL,
	CREATE,
}

/**
 * Enum representing the possible folder template that can be selected in the folder flow.
 */
export enum FolderTemplate {
	PYTHON_PROJECT = 'Python Project',
	R_PROJECT = 'R Project',
	JUPYTER_NOTEBOOK = 'Jupyter Notebook',
	EMPTY_PROJECT = 'Empty Project',
}
