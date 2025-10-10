/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export class NewFolderFlow {
	private get backButton(): Locator { return this.code.driver.page.getByRole('button', { name: 'Back', exact: true }); }
	private get cancelButton(): Locator { return this.code.driver.page.getByRole('button', { name: 'Cancel' }); }
	private get nextButton(): Locator { return this.code.driver.page.getByRole('button', { name: 'Next', exact: true }); }
	private get createButton(): Locator { return this.code.driver.page.getByRole('button', { name: 'Create', exact: true }); }
	private folderTemplateButton = (label: string) => this.code.driver.page.locator('label').filter({ hasText: label });
	private get folderNameInput(): Locator { return this.code.driver.page.getByLabel(/Enter the name of your new/); }
	private get existingEnvRadioButton(): Locator { return this.code.driver.page.getByText(/Use an existing/); }
	private get envProviderDropdown(): Locator { return this.code.driver.page.locator('#flow-sub-step-environment-creation').locator('button'); }
	private get envProviderDropdownTitle(): Locator { return this.envProviderDropdown.locator('.dropdown-entry-title'); }
	private get dropDropdownOptions(): Locator { return this.code.driver.page.locator('.positron-modal-popup-children').getByRole('button'); }
	private get interpreterDropdown(): Locator { return this.code.driver.page.locator('#flow-sub-step-pythonenvironment-interpreterorversion').locator('button'); }
	private get interpreterDropdownSubtitle(): Locator { return this.interpreterDropdown.locator('.dropdown-entry-subtitle'); }

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	/**
	 * NEW FOLDER FLOW:
	 * Step through the New Folder Flow in order to create a new folder.
	 * @param options The options to configure the new folder.
	 */
	async createNewFolder(options: CreateFolderOptions) {
		await test.step(`Create a new folder: ${options.folderName}`, async () => {
			await this.quickaccess.runCommand('positron.workbench.action.newFolderFromTemplate', { keepOpen: false });

			await this.setFolderTemplate(options.folderTemplate);
			await this.setFolderNameLocation(options);

			if (options.folderTemplate !== FolderTemplate.EMPTY_PROJECT) {
				await this.setConfiguration(options);
			}

			await this.code.driver.page.getByRole('button', { name: 'Current Window' }).click();
			await expect(this.code.driver.page.locator('.simple-title-bar').filter({ hasText: 'New Folder From Template' })).not.toBeVisible();
		});
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
		const { folderName, initGitRepo, createPyprojectToml, folderTemplate: type } = options;

		await this.folderNameInput.fill(folderName);
		if (initGitRepo) {
			await this.code.driver.page.getByText('Initialize Git repository').check();
		}

		if (type === FolderTemplate.PYTHON_PROJECT) {
			const checkboxLabel = this.code.driver.page.getByText('Create pyproject.toml file');
			const shouldBeChecked = createPyprojectToml ?? false;
			if (!shouldBeChecked) {
				// It's checked by default, so click to uncheck
				await checkboxLabel.click();
			}
		} else {
			await expect(this.code.driver.page.getByText('Create pyproject.toml file')).not.toBeVisible();
		}

		const button = options.folderTemplate === FolderTemplate.EMPTY_PROJECT ? FlowButton.CREATE : FlowButton.NEXT;
		await this.clickFlowButton(button);
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
	 * Helper: Retrieves a map of FolderTemplate to their locators in the New Folder Flow.
	 * This expects that the current page is the folder template step in the New Folder Flow modal dialog.
	 * @returns A map where each FolderTemplate is mapped to its locator.
	 */
	getFolderTemplateLocatorMap() {
		const folderTemplateLabelLocator = this.code.driver.page.locator('label');
		const folderTemplateLocators: Map<FolderTemplate, Locator> = new Map(
			Object.values(FolderTemplate).map((template: FolderTemplate) => [
				template,
				folderTemplateLabelLocator.filter({ hasText: template }),
			])
		);
		return folderTemplateLocators;
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

	async expectFolderTemplatesToBeVisible(visibleTemplates: Partial<Record<FolderTemplate, boolean>> = {}, closeModal = true) {
		const defaultVisibility: Record<FolderTemplate, boolean> = {
			[FolderTemplate.R_PROJECT]: false,
			[FolderTemplate.PYTHON_PROJECT]: false,
			[FolderTemplate.JUPYTER_NOTEBOOK]: false,
			[FolderTemplate.EMPTY_PROJECT]: false,
		};

		const mergedVisibility = { ...defaultVisibility, ...visibleTemplates };

		await test.step(`Verify folder flow template dialog`, async () => {
			await expect(this.code.driver.page.locator('.simple-title-bar-title').getByText('New Folder From Template')).toBeVisible();

			for (const template of Object.values(FolderTemplate)) {
				const isVisible = mergedVisibility[template];

				if (isVisible) {
					await test.step(`Verify "${template}" is visible`, async () => {
						await expect(this.folderTemplateButton(template)).toBeVisible();
					});
				} else {
					await test.step(`Verify "${template}" is not visible`, async () => {
						await expect(this.folderTemplateButton(template)).not.toBeVisible();
					});
				}
			}
		});

		if (closeModal) {
			await this.clickFlowButton(FlowButton.CANCEL);
		}
	}

	async verifyFolderCreation(folderName: string) {
		await test.step(`Verify folder created`, async () => {
			await expect(this.code.driver.page.locator('#top-action-bar-current-working-folder')).toHaveText(folderName, { timeout: 60000 }); // this is really slow on windows CI for some reason
		});
	}
}



export interface CreateFolderOptions {
	folderTemplate: FolderTemplate;
	folderName: string;
	status?: 'new' | 'existing';
	rEnvCheckbox?: boolean;
	pythonEnv?: 'conda' | 'venv' | 'uv';
	initGitRepo?: boolean;
	createPyprojectToml?: boolean;
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
