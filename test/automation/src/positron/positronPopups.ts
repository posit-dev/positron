/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const POSITRON_MODAL_DIALOG_BOX = '.positron-modal-dialog-box';
const POSITRON_MODAL_DIALOG_BOX_OK = '.positron-modal-dialog-box .ok-cancel-action-bar .positron-button.action-bar-button.default';
const NOTIFICATION_TOAST = '.notification-toast';

/*
 *  Reuseable Positron popups functionality for tests to leverage.
 */
export class PositronPopups {

	constructor(private code: Code) { }

	async installIPyKernel() {

		try {
			this.code.logger.log('Checking for modal dialog box');
			// fail fast if the modal is not present
			await this.code.waitForElement(POSITRON_MODAL_DIALOG_BOX, undefined, 50);
			await this.code.waitAndClick(POSITRON_MODAL_DIALOG_BOX_OK);
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

	async waitForToastToDisappear() {
		this.code.logger.log('Waiting for toast to be detacted');
		const toastLocator = this.code.driver.getLocator(NOTIFICATION_TOAST);
		await toastLocator.waitFor({ state: 'detached', timeout: 20000 });
	}

	async waitForToastToAppear() {
		this.code.logger.log('Waiting for toast to be attached');
		const toastLocator = this.code.driver.getLocator(NOTIFICATION_TOAST);
		await toastLocator.waitFor({ state: 'attached', timeout: 20000 });
	}
}
