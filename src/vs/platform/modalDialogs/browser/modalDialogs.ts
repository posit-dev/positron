/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogs';
import * as DOM from 'vs/base/browser/dom';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import { ModalDialog } from 'vs/base/browser/ui/modalDialog/modalDialog';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';

/**
 * ModalDialogs class.
 */
export class ModalDialogs implements IModalDialogsService {

	declare readonly _serviceBrand: undefined;

	/**
	 * Initializes a new instance of the ModalDialogs class.
	 * @param layoutService The layout service.
	 */
	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
	) {
	}

	/**
	 * Shows the time modal dialog.
	 */
	async showTimeModalDialog(): Promise<void> {
		// Create the time modal dialog.
		const modalDialog = new ModalDialog(this.layoutService.container, {
			title: 'Current Time',
			renderBody: (container: HTMLElement) => {
				// Placeholder.
				const placeholderElement = container.appendChild(DOM.$('.placeholder'));
				placeholderElement.innerText = new Date().toLocaleString();

				// I know this is going to leak when the dialog is closed. It's just test code.
				setInterval(() => {
					placeholderElement.innerText = new Date().toLocaleString();
				}, 1000);

			}
		});

		// Show the dialog.
		await modalDialog.show();

		// Dispose of the dialog.
		modalDialog.dispose();
	}
}
