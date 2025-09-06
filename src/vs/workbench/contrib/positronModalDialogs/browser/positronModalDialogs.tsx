/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalDialogs.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { Emitter } from '../../../../base/common/event.js';
import { renderHtml } from '../../../../base/browser/positron/renderHtml.js';
import { ContentArea } from '../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { OKActionBar } from '../../../browser/positronComponents/positronModalDialog/components/okActionBar.js';
import { VerticalStack } from '../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { OKCancelActionBar } from '../../../browser/positronComponents/positronModalDialog/components/okCancelActionBar.js';
import { OKCancelModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledTextInput } from '../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { IModalDialogPromptInstance, IPositronModalDialogsService, ShowConfirmationModalDialogOptions } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { ExternalLink } from '../../../../base/browser/ui/ExternalLink/ExternalLink.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';

/**
 * PositronModalDialogs class.
 */
export class PositronModalDialogs implements IPositronModalDialogsService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * Initializes a new instance of the PositronModalDialogs class.
	 */
	constructor() {
	}

	/**
	 * Shows a confirmation modal dialog.
	 * @param options The options.
	 */
	showConfirmationModalDialog(options: ShowConfirmationModalDialogOptions) {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer();

		// Show the confirmation modal dialog.
		renderer.render(
			<OKCancelModalDialog
				cancelButtonTitle={options.cancelButtonTitle}
				height={195}
				okButtonTitle={options.okButtonTitle}
				renderer={renderer}
				title={options.title}
				width={400}
				onAccept={async () => {
					renderer.dispose();
					await options.action();
				}}
				onCancel={() => renderer.dispose()}>
				<VerticalStack>
					<div>{options.message}</div>
				</VerticalStack>
			</OKCancelModalDialog>
		);
	}

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
	): IModalDialogPromptInstance {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer();

		// Single-shot emitter for the user's choice.
		const choiceEmitter = new Emitter<boolean>();

		const acceptHandler = () => {
			renderer.dispose();
			choiceEmitter.fire(true);
			choiceEmitter.dispose();
		};
		const cancelHandler = () => {
			renderer.dispose();
			choiceEmitter.fire(false);
			choiceEmitter.dispose();
		};

		renderer.render(
			<PositronModalDialog height={200} renderer={renderer} title={title} width={400} onCancel={cancelHandler}>
				<ContentArea>
					{renderHtml(
						message,
						{
							componentOverrides: {
								a: (props) => <ExternalLink {...props} />
							}
						}
					)}
				</ContentArea>
				<OKCancelActionBar
					cancelButtonTitle={cancelButtonTitle}
					okButtonTitle={okButtonTitle}
					onAccept={acceptHandler}
					onCancel={cancelHandler} />
			</PositronModalDialog>
		);

		return {
			onChoice: choiceEmitter.event,
			close() {
				choiceEmitter.fire(false);
				choiceEmitter.dispose();
				renderer.dispose();
			}
		};
	}

	/**
	 * Shows a modal dialog prompt.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
	 *
	 * @returns A dialog instance, with an event that fires when the user dismisses the dialog.
	 */
	showModalDialogPrompt2(
		title: string,
		message: string,
		okButtonTitle?: string
	): IModalDialogPromptInstance {

		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer();

		// Single-shot emitter for the user's choice.
		const choiceEmitter = new Emitter<boolean>();

		const acceptHandler = () => {
			renderer.dispose();
			choiceEmitter.fire(true);
			choiceEmitter.dispose();
		};

		const cancelHandler = () => {
			renderer.dispose();
			choiceEmitter.dispose();
		};

		renderer.render(
			<PositronModalDialog
				height={200}
				renderer={renderer}
				title={title}
				width={400}
				onCancel={cancelHandler}
			>
				<ContentArea>
					{renderHtml(
						message,
						{
							componentOverrides: {
								a: (props) => <ExternalLink {...props} />
							}
						}
					)}
				</ContentArea>
				<OKActionBar okButtonTitle={okButtonTitle} onAccept={acceptHandler} />
			</PositronModalDialog>
		);

		return {
			onChoice: choiceEmitter.event,
			close() {
				choiceEmitter.fire(true);
				choiceEmitter.dispose();
				renderer.dispose();
			}
		};
	}

	/**
	 * Shows a simple modal dialog prompt. This is a simpler variant of
	 * `showModalDialogPrompt` for convenience. If you need to be able to force
	 * the dialog to close, use the `showModalDialogPrompt` method instead.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
	 * @param cancelButtonTitle The title of the Cancel button (optional; defaults to 'Cancel')
	 *
	 * @returns A promise that resolves to true if the user clicked OK, or false
	 *   if the user clicked Cancel.
	 */
	showSimpleModalDialogPrompt(title: string,
		message: string,
		okButtonTitle?: string | undefined,
		cancelButtonTitle?: string | undefined): Promise<boolean> {

		// Show the dialog and return a promise that resolves to the user's choice.
		const dialog = this.showModalDialogPrompt(title, message, okButtonTitle, cancelButtonTitle);
		return new Promise<boolean>((resolve) => {
			const disposable = dialog.onChoice((choice) => {
				disposable.dispose();
				resolve(choice);
			});
		});
	}

	/**
	 * Shows a simple modal dialog prompt for the user to accept.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
	 *
	 * @returns A promise that resolves when the user dismisses the dialog.
	 */
	showSimpleModalDialogMessage(title: string,
		message: string,
		okButtonTitle?: string | undefined): Promise<null> {

		// Show the dialog and return a promise that resolves when the user makes a choice.
		const dialog = this.showModalDialogPrompt2(title, message, okButtonTitle);
		return new Promise<null>((resolve) => {
			const disposable = dialog.onChoice(() => {
				disposable.dispose();
				resolve(null);
			});
		});
	}

	/**
	 * Shows a modal dialog with a text input field.
	 *
	 * @param title The title of the dialog
	 * @param message The message to display in the dialog
	 * @param defaultValue The default value to show in the input field (optional)
	 * @param placeholder The placeholder text for the input field (optional)
	 *
	 * @returns A promise that resolves to the text entered by the user, or null if cancelled.
	 */
	showSimpleModalDialogInput(
		title: string,
		message: string,
		defaultValue?: string,
		placeholder?: string
	): Promise<string | null> {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer();

		// Component to handle the input dialog
		const InputDialogComponent = () => {
			const [inputValue, setInputValue] = useState(defaultValue || '');

			const acceptHandler = () => {
				renderer.dispose();
				resolve(inputValue);
			};

			const cancelHandler = () => {
				renderer.dispose();
				resolve(null);
			};

			return (
				<PositronModalDialog height={280} renderer={renderer} title={title} width={400} onCancel={cancelHandler}>
					<ContentArea>
						<VerticalStack>
							{message && (
								<div>
									{renderHtml(
										message,
										{
											componentOverrides: {
												a: (props) => <ExternalLink {...props} />
											}
										}
									)}
								</div>
							)}
							<LabeledTextInput
								label=""
								value={inputValue}
								autoFocus={true}
								onChange={(e) => setInputValue(e.target.value)}
								{...placeholder && { placeholder }}
							/>
						</VerticalStack>
					</ContentArea>
					<OKCancelActionBar
						onAccept={acceptHandler}
						onCancel={cancelHandler}
					/>
				</PositronModalDialog>
			);
		};

		// Promise to handle the user's input
		let resolve: (value: string | null) => void;
		const promise = new Promise<string | null>((res) => {
			resolve = res;
		});

		renderer.render(<InputDialogComponent />);

		return promise;
	}
}
