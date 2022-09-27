/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialog';
import * as DOM from 'vs/base/browser/dom';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';

/**
 * IModalDialogOptions interface.
 */
export interface IModalDialogOptions {
	readonly title: string;
	readonly renderContent?: (container: HTMLElement) => IDisposable | void;
}

/**
 * ModalDialog class.
 */
export class ModalDialog extends Disposable {
	//#region Private Member Variables

	private modalBlockElement: HTMLElement | undefined;
	private readonly shadowContainerElement: HTMLElement;
	private readonly dialogBoxElement: HTMLElement;
	private readonly dialogBoxBodyElement: HTMLElement;
	private readonly titleBarElement: HTMLElement;
	private readonly titleElement: HTMLElement;
	private readonly contentAreaElement: HTMLElement;
	private readonly actionsBarElement: HTMLElement;
	private readonly okButtonElement: HTMLElement | undefined;

	//#endregion Private Member Variables

	//#region Class Initialization

	/**
	 * Initializes a new instance of the ModalDialog class.
	 * @param container The HTMLElement that contains the ModalDialog.
	 */
	constructor(private container: HTMLElement, modalDialogOptions: IModalDialogOptions) {
		// Initialize.
		super();

		// Create the basic dialog box.
		this.modalBlockElement = this.container.appendChild(DOM.$(`.monaco-modal-dialog-modal-block.dimmed`));
		this.shadowContainerElement = this.modalBlockElement.appendChild(DOM.$('.modal-dialog-shadow-container'));
		this.dialogBoxElement = this.shadowContainerElement.appendChild(DOM.$('.monaco-modal-dialog-box'));
		this.dialogBoxElement.setAttribute('role', 'dialog');
		this.dialogBoxElement.tabIndex = -1;

		// Create the dialog box body.
		this.dialogBoxBodyElement = this.dialogBoxElement.appendChild(DOM.$('.monaco-modal-dialog-box-body'));

		// Create the title bar and title.
		this.titleBarElement = this.dialogBoxBodyElement.appendChild(DOM.$('.title-bar'));
		this.titleElement = this.titleBarElement.appendChild(DOM.$('.title-bar-title'));
		this.titleElement.innerText = modalDialogOptions.title;

		// Create the content area.
		this.contentAreaElement = this.dialogBoxBodyElement.appendChild(DOM.$('.content-area'));

		// Render the content.
		if (modalDialogOptions.renderContent) {
			// Render the component and, if it's an IDisposable, register it.
			const content = modalDialogOptions.renderContent(this.contentAreaElement);
			if (content) {
				this._register(content);
			}
		}

		// Create the actions bar and actions.
		this.actionsBarElement = this.dialogBoxBodyElement.appendChild(DOM.$('.actions-bar.top'));

		// Add the OK button.
		this.okButtonElement = DOM.$('a');
		this.okButtonElement = document.createElement('a');
		this.okButtonElement.classList.add('push-button');
		this.okButtonElement.tabIndex = 0;
		this.okButtonElement.setAttribute('role', 'button');
		this.okButtonElement.innerText = 'OK';
		this.actionsBarElement.appendChild(this.okButtonElement);

		// Hide the dialog box element until it's shown.
		DOM.hide(this.dialogBoxElement);
	}

	/**
	 * Disposes the modal dialog box.
	 */
	override dispose(): void {
		// Dispose super.
		super.dispose();

		// Remove the modal block element.
		if (this.modalBlockElement) {
			this.modalBlockElement.remove();
			this.modalBlockElement = undefined;
		}
	}

	/**
	 * Shows the modal dialog box.
	 */
	async show(): Promise<void> {
		//const focusToReturn = document.activeElement as HTMLElement;

		return new Promise<void>((resolve) => {
			DOM.show(this.dialogBoxElement);
			this.dialogBoxElement.focus();

			if (this.okButtonElement) {
				this.okButtonElement.onclick = () => {
					resolve();
				};
			}
		});
	}

	//#endregion Class Initialization
}
