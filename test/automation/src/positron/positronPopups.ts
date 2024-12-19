/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Code } from '../code';

const POSITRON_MODAL_DIALOG_BOX = '.positron-modal-dialog-box';
const POSITRON_MODAL_DIALOG_BOX_OK = '.positron-modal-dialog-box .ok-cancel-action-bar .positron-button.action-bar-button.default';
const POSITRON_MODAL_DIALOG_BOX_CANCEL = '.positron-modal-dialog-box .ok-cancel-action-bar .positron-button.action-bar-button:not(.default)';
const POSITRON_MODAL_DIALOG_BOX_TITLE = '.positron-modal-dialog-box .simple-title-bar-title';
const POSITRON_MODAL_DIALOG_POPUP_OPTION = '.positron-modal-popup .positron-modal-popup-children';
const NOTIFICATION_TOAST = '.notification-toast';

/*
 *  Reuseable Positron popups functionality for tests to leverage.
 */
export class PositronPopups {

	toastLocator = this.code.driver.page.locator(NOTIFICATION_TOAST);

	constructor(private code: Code) { }

	async popupCurrentlyOpen() {
		try {
			await this.code.waitForElement(POSITRON_MODAL_DIALOG_BOX, undefined, 50);
			return true;
		} catch (error) {
			this.code.logger.log('No modal dialog box found');
		}
	}

	async installIPyKernel() {

		try {
			this.code.logger.log('Checking for modal dialog box');
			// fail fast if the modal is not present
			await this.code.waitForElement(POSITRON_MODAL_DIALOG_BOX, undefined, 50);
			await this.code.driver.page.locator(POSITRON_MODAL_DIALOG_BOX_OK).click();
			this.code.logger.log('Installing ipykernel');
			await this.waitForToastToAppear();
			await this.waitForToastToDisappear();
			this.code.logger.log('Installed ipykernel');
			// after toast disappears console may not yet be refreshed (still on old interpreter)
			// TODO: make this smart later, perhaps by getting the console state from the API
			await this.code.wait(5000);
		} catch {
			this.code.logger.log('Did not find modal dialog box');
		}
	}

	/**
	 * Interacts with the Renv install modal dialog box. This dialog box appears when a user opts to
	 * use Renv in the Project Wizard and creates a new project, but Renv is not installed.
	 * @param install Whether to install Renv or not. Default is true.
	 */
	async installRenv(install: boolean = true) {
		try {
			this.code.logger.log('Checking for install Renv modal dialog box');
			// fail fast if the renv install modal is not present
			await this.code.waitForTextContent(
				POSITRON_MODAL_DIALOG_BOX_TITLE,
				'Missing R package',
				undefined,
				50
			);
			if (install) {
				this.code.logger.log('Installing Renv');
				await this.code.driver.page.locator(POSITRON_MODAL_DIALOG_BOX_OK).click();
				this.code.logger.log('Installed Renv');
			} else {
				this.code.logger.log('Skipping Renv installation');
				await this.code.driver.page.locator(POSITRON_MODAL_DIALOG_BOX_CANCEL).click();
			}
		} catch {
			this.code.logger.log('Did not find install Renv modal dialog box');
		}
	}
	async waitForToastToDisappear() {
		this.code.logger.log('Waiting for toast to be detacted');
		await this.toastLocator.waitFor({ state: 'detached', timeout: 20000 });
	}

	async waitForToastToAppear() {
		this.code.logger.log('Waiting for toast to be attached');
		await this.toastLocator.waitFor({ state: 'attached', timeout: 20000 });
	}

	async verifyToastDoesNotAppear(timeoutMs: number = 3000): Promise<void> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			const count = await this.toastLocator.count();
			if (count > 0) {
				throw new Error('Toast appeared unexpectedly');
			}

			this.code.wait(1000);
		}

		this.code.logger.log('Verified: Toast did not appear');
	}

	async closeAllToasts() {
		const count = await this.toastLocator.count();
		this.code.logger.log(`Closing ${count} toasts`);
		for (let i = 0; i < count; i++) {
			await this.toastLocator.nth(i).hover();
			await this.code.driver.page.locator(`${NOTIFICATION_TOAST} .codicon-notifications-clear`).nth(i).click();
		}
	}

	async waitForModalDialogBox() {
		await expect(this.code.driver.page.locator(POSITRON_MODAL_DIALOG_BOX)).toBeVisible({ timeout: 30000 });
	}

	async waitForModalDialogBoxToDisappear() {
		await expect(this.code.driver.page.locator(POSITRON_MODAL_DIALOG_BOX)).not.toBeVisible({ timeout: 30000 });
	}

	async clickOkOnModalDialogBox() {
		await this.code.driver.page.locator(POSITRON_MODAL_DIALOG_BOX_OK).click();
	}

	async clickCancelOnModalDialogBox() {
		await this.code.driver.page.locator(POSITRON_MODAL_DIALOG_BOX_CANCEL).click();
	}

	/**
	 * Can be called after a DropDownListBox is clicked. Selects the option with the given label.
	 * @param label The label of the option to select.
	 */
	async clickOnModalDialogPopupOption(label: string | RegExp) {
		const el = this.code.driver.page.locator(POSITRON_MODAL_DIALOG_POPUP_OPTION).getByText(label);
		await el.click();
	}

	/**
	 * Waits for the modal dialog box title to match the given title.
	 * @param title The title to wait for.
	 */
	async waitForModalDialogTitle(title: string) {
		await this.code.waitForTextContent(POSITRON_MODAL_DIALOG_BOX_TITLE, title);
	}
}
