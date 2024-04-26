/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from './code';

const POSITRON_MODAL_DIALOG_BOX = '.positron-modal-dialog-box';
const POSITRON_MODAL_DIALOG_BOX_OK = '.positron-modal-dialog-box .ok-cancel-action-bar .positron-button.action-bar-button.default';
const NOTIFICATION_TOAST = '.notification-toast';

export class PositronPopups {

	constructor(private code: Code) { }

	async installIPyKernel() {

		try {
			await this.code.waitForElement(POSITRON_MODAL_DIALOG_BOX, undefined, 50);
			await this.code.waitAndClick(POSITRON_MODAL_DIALOG_BOX_OK);
			console.log('Installing ipykernel');
			await this.code.driver.wait(5000); // give the toast time to appear
			await this.waitForToastToDisappear();
			console.log('Installed ipykernel');
			await this.code.wait(5000);  // after toast disappears console may not yet be refreshed
		} catch { }
	}

	async waitForToastToDisappear() {
		console.log('Waiting for toast to be detacted');
		const toastLocator = this.code.driver.getLocator(NOTIFICATION_TOAST);
		await toastLocator.waitFor({ state: 'detached', timeout: 20000 });
	}
}
