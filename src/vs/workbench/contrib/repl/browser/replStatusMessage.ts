/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';

/**
 * A rendered status message from the kernel
 */
export class ReplStatusMessage extends Disposable {
	private _ele: HTMLElement;

	constructor(codicon: string, message: string) {
		super();

		// Create the root render element (unattached until rendered)
		this._ele = document.createElement('div');

		// Create the icon
		const ico = document.createElement('span');
		ico.classList.add('codicon', `codicon-${codicon}`);
		this._ele.appendChild(ico);

		// Create the message
		const msg = document.createElement('span');
		msg.textContent = message;
		this._ele.appendChild(msg);

		this._ele.classList.add('repl-status-message');
	}

	public render(parent: HTMLElement): void {
		parent.appendChild(this._ele);
	}
}
