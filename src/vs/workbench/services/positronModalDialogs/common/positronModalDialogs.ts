/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

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

	/**
	 * Shows a modal dialog with a text input field.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param defaultValue The default value to show in the input field (optional)
	 * @param placeholder The placeholder text for the input field (optional)
	 * @param timeout The maximum time to wait for user input, in seconds (optional)
	 *
	 * @returns A promise that resolves to the text entered by the user, or null if cancelled.
	 */
	showSimpleModalDialogInput(
		title: string,
		message: string,
		defaultValue?: string,
		placeholder?: string,
		timeout?: number
	): Promise<string | null>;
}
