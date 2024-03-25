/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * Export the service identifier.
 */
export const IPositronModalDialogsService = createDecorator<IPositronModalDialogsService>('positronModalDialogsService');

/**
 * Represents an instance of a single modal dialog.
 */
export interface IModalDialogPromptInstance {
	/**
	 * Fires when the user makes a selection.
	 */
	onChoice: Event<boolean>;

	/**
	 * Closes the dialog. Note that this will cause the onChoice event to fire
	 * with a value of `false`.
	 */
	close(): void;
}

/**
 * ShowConfirmationModalDialogOptions interface.
 */
export interface ShowConfirmationModalDialogOptions {
	title: string;
	message: string;
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	action: () => Promise<void>;
}

/**
 * A service that displays modal dialogs.
 */
export interface IPositronModalDialogsService {

	readonly _serviceBrand: undefined;

	/**
	 * Shows a confirmation modal dialog.
	 * @param options The options.
	 */
	showConfirmationModalDialog(options: ShowConfirmationModalDialogOptions): void;

	/**
	 * Shows a modal dialog prompt.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
	 * @param cancelButtonTitle The title of the Cancel button (optional; defaults to 'Cancel')
	 *
	 * @returns A dialog instance, with an event that fires when the user makes a selection.
	 */
	showModalDialogPrompt(
		title: string,
		message: string,
		okButtonTitle?: string,
		cancelButtonTitle?: string
	): IModalDialogPromptInstance;

	/**
	 * Shows a simple modal dialog prompt. This is a simpler variant of
	 * `showModalDialogPrompt` for convenience. If you need to be able to force
	 * the dialog to close, use the `showModalDialogPrompt` method instead.
	 *
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
	 * @param cancelButtonTitle The title of the Cancel button (optional; defaults to 'Cancel')
	 *
	 * @returns A promise that resolves to true if the user clicked OK, or false
	 *   if the user clicked Cancel.
	 */
	showSimpleModalDialogPrompt(
		title: string,
		message: string,
		okButtonTitle?: string,
		cancelButtonTitle?: string
	): Promise<boolean>;

	/**
	 * Shows a different simple modal dialog prompt.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
	 *
	 * @returns A promise that resolves when the user dismisses the dialog.
	 */
	showSimpleModalDialogMessage(
		title: string,
		message: string,
		okButtonTitle?: string
	): Promise<null>;
}
