/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalDialogs';

// React.
import * as React from 'react';

// Other dependencies.
import { Emitter } from 'vs/base/common/event';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ComboBox } from 'vs/workbench/browser/positronComponents/comboBox/comboBox';
import { TestContent } from 'vs/workbench/contrib/positronHistory/browser/components/testContent';
import { ComboBoxMenuItem } from 'vs/workbench/browser/positronComponents/comboBox/comboBoxMenuItem';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { OKActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okActionBar';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { OKCancelActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okCancelActionBar';
import { IModalDialogPromptInstance, IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';

/**
 * PositronModalDialogs class.
 */
export class PositronModalDialogs implements IPositronModalDialogsService {

	declare readonly _serviceBrand: undefined;

	/**
	 * Initializes a new instance of the PositronModalDialogs class.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 */
	constructor(
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService
	) { }

	/**
	 * Shows example modal dialog 1.
	 * @returns A Promise<void> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog1(title: string): Promise<void> {
		// Build the test combo box entries.
		const testEntries = [
			new ComboBoxMenuItem({
				identifier: '1',
				label: 'Test Item 1'
			}),
			new ComboBoxMenuItem({
				identifier: '2',
				label: 'Test Item 2'
			}),
			new ComboBoxMenuItem({
				identifier: '3',
				label: 'Test Item 3'
			}),
			new ComboBoxMenuItem({
				identifier: '4',
				label: 'Test Item 4'
			}),
			new ComboBoxMenuItem({
				identifier: '5',
				label: 'Test Item 5'
			}),
			new ComboBoxMenuItem({
				identifier: '6',
				label: 'Test Item 6'
			}),
		];

		// Return a promise that resolves when the example modal dialog is done.
		return new Promise<void>((resolve) => {
			// Create the modal React renderer.
			const renderer = new PositronModalReactRenderer({
				keybindingService: this._keybindingService,
				layoutService: this._layoutService,
				container: this._layoutService.mainContainer
			});

			// The accept handler.
			const acceptHandler = () => {
				renderer.dispose();
				resolve();
			};

			// The modal dialog component.
			const ModalDialog = () => {
				return (
					<PositronModalDialog renderer={renderer} title={title} width={400} height={300} onAccept={acceptHandler} onCancel={acceptHandler}>
						<ContentArea>
							<ComboBox
								keybindingService={this._keybindingService}
								layoutService={this._layoutService}
								className='combo-box'
								title='Select Column'
								entries={testEntries}
								onSelectionChanged={identifier => console.log(`Select Column changed to ${identifier}`)}
							/>
						</ContentArea>
						<OKActionBar onAccept={acceptHandler} />
					</PositronModalDialog>
				);
			};

			// Render the modal dialog component.
			renderer.render(<ModalDialog />);
		});
	}

	/**
	 * Shows example modal dialog 2.
	 * @returns A Promise<boolean> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog2(title: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			// Create the modal React renderer.
			const renderer = new PositronModalReactRenderer({
				keybindingService: this._keybindingService,
				layoutService: this._layoutService,
				container: this._layoutService.mainContainer
			});

			// The accept handler.
			const acceptHandler = () => {
				renderer.dispose();
				resolve(true);
			};

			// The cancel handler.
			const cancelHandler = () => {
				renderer.dispose();
				resolve(false);
			};

			// The modal dialog component.
			const ModalDialog = () => {
				// Render.
				return (
					<PositronModalDialog renderer={renderer} title={title} width={400} height={300} onAccept={acceptHandler} onCancel={cancelHandler}>
						<ContentArea>
							<TestContent message='Example' />
						</ContentArea>
						<OKCancelActionBar onAccept={acceptHandler} onCancel={cancelHandler} />
					</PositronModalDialog>
				);
			};

			// Render the modal dialog component.
			renderer.render(<ModalDialog />);
		});
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
		const renderer = new PositronModalReactRenderer({
			keybindingService: this._keybindingService,
			layoutService: this._layoutService,
			container: this._layoutService.mainContainer
		});

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

		// Render the dialog. As the messaage is variably sized, it'd be
		// nice if we could auto-scale the dialog, but fix it to 200 for
		// now.
		const ModalDialog = () => {
			return (
				<PositronModalDialog renderer={renderer} title={title} width={400} height={200} onAccept={acceptHandler} onCancel={cancelHandler}>
					<ContentArea>
						{message}
					</ContentArea>
					<OKCancelActionBar
						okButtonTitle={okButtonTitle}
						cancelButtonTitle={cancelButtonTitle}
						onAccept={acceptHandler}
						onCancel={cancelHandler} />
				</PositronModalDialog>
			);
		};

		renderer.render(<ModalDialog />);

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
		const renderer = new PositronModalReactRenderer({
			keybindingService: this._keybindingService,
			layoutService: this._layoutService,
			container: this._layoutService.mainContainer
		});

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

		// Render the dialog. As the messaage is variably sized, it'd be
		// nice if we could auto-scale the dialog, but fix it to 200 for
		// now.
		const ModalDialog = () => {
			return (
				<PositronModalDialog renderer={renderer} title={title} width={400} height={200} onAccept={acceptHandler} onCancel={cancelHandler} >
					<ContentArea>
						{message}
					</ContentArea>
					<OKActionBar
						okButtonTitle={okButtonTitle}
						onAccept={acceptHandler} />
				</PositronModalDialog>
			);
		};

		renderer.render(<ModalDialog />);

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
			dialog.onChoice((choice) => {
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
			dialog.onChoice(() => {
				resolve(null);
			});
		});
	}
}
