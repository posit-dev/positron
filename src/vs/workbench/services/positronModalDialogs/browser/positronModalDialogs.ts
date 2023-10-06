/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * Export the service identifier.
 */
export const IPositronModalDialogsService = createDecorator<IPositronModalDialogsService>('positronModalDialogsService');

/**
 * A service that displays modal dialogs.
 */
export interface IPositronModalDialogsService {

	readonly _serviceBrand: undefined;

	/**
	 * Shows example modal dialog 1.
	 */
	showExampleModalDialog1(title: string): Promise<void>;

	/**
	 * Shows example modal dialog 2.
	 */
	showExampleModalDialog2(title: string): Promise<boolean>;

	/**
	 * Shows a simple modal dialog prompt.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
	 * @param cancelButtonTitle The title of the Cancel button (optional; defaults to 'Cancel')
	 *
	 * @returns A promise that resolves to true if the user clicked OK, or false
	 *   if the user clicked Cancel (or closed the dialog)
	 */
	showModalDialogPrompt(title: string,
		message: string,
		okButtonTitle?: string,
		cancelButtonTitle?: string): Promise<boolean>;
}
