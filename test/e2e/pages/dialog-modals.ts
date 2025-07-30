/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
import { Code } from '../infra/code.js';
import { Console } from '../infra';
import { Toasts } from './dialog-toasts.js';

export class Modals {
	public modalBox = this.code.driver.page.locator('.positron-modal-dialog-box');
	public modalTitle = this.modalBox.locator('.simple-title-bar-title');
	public modalMessage = this.code.driver.page.locator('.dialog-box .message');
	public okButton = this.modalBox.getByRole('button', { name: 'OK' });
	public cancelButton = this.modalBox.getByRole('button', { name: 'Cancel' });
	public button = (label: string | RegExp) => this.modalBox.getByRole('button', { name: label });

	constructor(private readonly code: Code, private toasts: Toasts, private console: Console) { }

	// --- Actions ---

	async clickOk() {
		await test.step('Click `OK` on modal dialog box', async () => {
			await this.okButton.click();
		});
	}

	async clickCancel() {
		await test.step('Click `Cancel` on modal dialog box', async () => {
			await this.cancelButton.click();
		});
	}

	async clickButton(label: string | RegExp) {
		await test.step(`Click button in modal dialog box: ${label}`, async () => {
			await this.button(label).click();
		});
	}

	async installIPyKernel() {

		try {
			this.code.logger.log('Checking for modal dialog box');
			// fail fast if the modal is not present
			await this.expectToBeVisible();
			await this.clickOk();
			this.code.logger.log('Installing ipykernel');
			await this.toasts.expectToBeVisible();
			await this.toasts.expectNotToBeVisible();
			this.code.logger.log('Installed ipykernel');
			// after toast disappears console may not yet be refreshed (still on old interpreter)
			// TODO: make this smart later, perhaps by getting the console state from the API
			await this.code.wait(5000);
		} catch {
			this.code.logger.log('Did not find modal dialog box for ipykernel install');
		}
	}

	/**
	 * Interacts with the Renv install modal dialog box. This dialog box appears when a user opts to
	 * use Renv in the New Folder Flow and creates a new folder, but Renv is not installed.
	 * @param action The action to take on the modal dialog box. Either 'install' or 'cancel'.
	 */
	async installRenvModal(action: 'install' | 'cancel') {
		try {
			await expect(this.code.driver.page.locator('.simple-title-bar').filter({ hasText: 'Missing R package' })).toBeVisible({ timeout: 30000 });

			if (action === 'install') {
				this.code.logger.log('Install Renv modal detected: clicking `Install now`');
				await this.button('Install now').click();
			} else if (action === 'cancel') {
				this.code.logger.log('Install Renv modal detected: clicking `Cancel`');
				await this.button('Cancel').click();
			}
		} catch (error) {
			this.code.logger.log('No Renv modal detected; interacting with console directly');

			await this.console.typeToConsole('y');
			await this.console.sendEnterKey();
		}
	}

	// --- Verifications ---

	async expectMessageToContain(text: string | RegExp) {
		await test.step(`Verify modal dialog box contains text: ${text}`, async () => {
			await expect(this.modalMessage).toContainText(text);
		});
	}

	async expectToBeVisible(title?: string) {
		await test.step(`Verify modal dialog box is visible${title ? ` : ${title}` : ''}`, async () => {
			await expect(this.modalBox).toBeVisible({ timeout: 30000 });
			if (title) {
				await expect(this.modalTitle).toHaveText(title, { timeout: 30000 });
			}
		});
	}

	async expectButtonToBeVisible(buttonLabel: string) {
		await test.step(`Verify button is visible: ${buttonLabel}`, async () => {
			await expect(this.modalBox.getByRole('button', { name: buttonLabel })).toBeVisible();
		});
	}

	async expectToContainText(text: string | RegExp) {
		await test.step(`Verify modal dialog box has text: ${text}`, async () => {
			await expect(this.modalBox).toContainText(text);
		});
	}
}
