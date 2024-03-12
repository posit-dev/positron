/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialogs';
import * as React from 'react';
import { Emitter } from 'vs/base/common/event';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { TestContent } from 'vs/base/browser/ui/positronModalDialog/components/testContent';
import { OKActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okActionBar';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { PositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { OKCancelActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelActionBar';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { IModalDialogPromptInstance, IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';
import { ComboBox } from 'vs/base/browser/ui/positronComponents/comboBox/comboBox';
import { ComboBoxMenuItem } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuItem';

/**
 * PositronModalDialogs class.
 */
export class PositronModalDialogs implements IPositronModalDialogsService {

	declare readonly _serviceBrand: undefined;

	/**
	 * Initializes a new instance of the PositronModalDialogs class.
	 * @param layoutService The layout service.
	 */
	constructor(@ILayoutService private readonly layoutService: ILayoutService) { }

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
			const positronModalReactRenderer =
				new PositronModalReactRenderer(this.layoutService.mainContainer);

			// The accept handler.
			const acceptHandler = () => {
				positronModalReactRenderer.dispose();
				resolve();
			};

			// The modal dialog component.
			const ModalDialog = () => {
				return (
					<PositronModalDialog renderer={positronModalReactRenderer} title={title} width={400} height={300} accept={acceptHandler} cancel={acceptHandler}>
						<ContentArea>
							<ComboBox
								layoutService={this.layoutService}
								className='combo-box'
								title='Select Column'
								entries={testEntries}
								onSelectionChanged={identifier => console.log(`Select Column changed to ${identifier}`)}
							/>

						</ContentArea>
						<OKActionBar accept={acceptHandler} />
					</PositronModalDialog>
				);
			};

			// Render the modal dialog component.
			positronModalReactRenderer.render(<ModalDialog />);
		});
	}

	/**
	 * Shows example modal dialog 2.
	 * @returns A Promise<boolean> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog2(title: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			// Create the modal React renderer.
			const positronModalReactRenderer =
				new PositronModalReactRenderer(this.layoutService.mainContainer);

			// The accept handler.
			const acceptHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(true);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(false);
			};

			// The modal dialog component.
			const ModalDialog = () => {
				// Render.
				return (
					<PositronModalDialog renderer={positronModalReactRenderer} title={title} width={400} height={300} accept={acceptHandler} cancel={cancelHandler}>
						<ContentArea>
							<TestContent message='Example' />
						</ContentArea>
						<OKCancelActionBar accept={acceptHandler} cancel={cancelHandler} />
					</PositronModalDialog>
				);
			};

			// Render the modal dialog component.
			positronModalReactRenderer.render(<ModalDialog />);
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
	showModalDialogPrompt(title: string,
		message: string,
		okButtonTitle?: string,
		cancelButtonTitle?: string): IModalDialogPromptInstance {

		const positronModalReactRenderer =
			new PositronModalReactRenderer(this.layoutService.mainContainer);

		// Single-shot emitter for the user's choice.
		const choiceEmitter = new Emitter<boolean>();

		const acceptHandler = () => {
			positronModalReactRenderer.dispose();
			choiceEmitter.fire(true);
			choiceEmitter.dispose();
		};
		const cancelHandler = () => {
			positronModalReactRenderer.dispose();
			choiceEmitter.fire(false);
			choiceEmitter.dispose();
		};

		// Render the dialog. As the messaage is variably sized, it'd be
		// nice if we could auto-scale the dialog, but fix it to 200 for
		// now.
		const ModalDialog = () => {
			return (
				<PositronModalDialog renderer={positronModalReactRenderer} title={title} width={400} height={200} accept={acceptHandler} cancel={cancelHandler}>
					<ContentArea>
						{message}
					</ContentArea>
					<OKCancelActionBar
						okButtonTitle={okButtonTitle}
						cancelButtonTitle={cancelButtonTitle}
						accept={acceptHandler}
						cancel={cancelHandler} />
				</PositronModalDialog>
			);
		};

		positronModalReactRenderer.render(<ModalDialog />);

		return {
			onChoice: choiceEmitter.event,
			close() {
				choiceEmitter.fire(false);
				choiceEmitter.dispose();
				positronModalReactRenderer.dispose();
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
}
