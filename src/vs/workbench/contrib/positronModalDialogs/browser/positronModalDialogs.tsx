/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalDialogs';

// React.
import * as React from 'react';

// Other dependencies.
import { Emitter } from 'vs/base/common/event';
import { renderHtml } from 'vs/base/browser/renderHtml';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { OKActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okActionBar';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { OKCancelActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okCancelActionBar';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';
import { IModalDialogPromptInstance, IPositronModalDialogsService, ShowConfirmationModalDialogOptions } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';

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
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _openerService The opener service.
	 */
	constructor(
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@IOpenerService private readonly _openerService: IOpenerService,
	) { }

	/**
	 * Shows a confirmation modal dialog.
	 * @param options The options.
	 */
	showConfirmationModalDialog(options: ShowConfirmationModalDialogOptions) {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: this._keybindingService,
			layoutService: this._layoutService,
			container: this._layoutService.activeContainer
		});

		// Show the confirmation modal dialog.
		renderer.render(
			<OKCancelModalDialog
				renderer={renderer}
				width={400}
				height={195}
				title={options.title}
				okButtonTitle={options.okButtonTitle}
				cancelButtonTitle={options.cancelButtonTitle}
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

		renderer.render(
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

		renderer.render(
			<PositronModalDialog
				renderer={renderer}
				title={title}
				width={400}
				height={200}
				onAccept={acceptHandler}
				onCancel={cancelHandler}
			>
				<ContentArea>
					{renderHtml(
						message,
						{
							onLinkClick: (href: string) => this._openerService.open(href)
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
