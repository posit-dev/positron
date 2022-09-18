/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

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

		console.log('We are here');
		const ddd = new ModalDialog(this.layoutService.container, {
			title: 'Current Time'
		});
		await ddd.show();
	}
}
