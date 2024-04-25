/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from './code';

const POSITRON_MODAL_DIALOG_BOX = '.positron-modal-dialog-box';
const POSITRON_MODAL_DIALOG_BOX_OK = '.positron-modal-dialog-box .ok-cancel-action-bar .positron-button.action-bar-button.default';

export class PositronPopups {

	constructor(private code: Code) { }

	async installIPyKernel() {

		try {
			await this.code.waitForElement(POSITRON_MODAL_DIALOG_BOX, undefined, 50);
			await this.code.waitAndClick(POSITRON_MODAL_DIALOG_BOX_OK);
			console.log('Installed ipykernel');
			await this.code.wait(20000); // need to look for cursor instead?
		} catch { }
	}
}
