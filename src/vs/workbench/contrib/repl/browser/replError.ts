/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';

type ErrorLike = Partial<Error>;

/**
 * A rendered version of an error from a kernel
 */
export class ReplError extends Disposable {
	private _err: ErrorLike;

	private _ele: HTMLElement;

	constructor(errText: string,
		@ILogService logService: ILogService) {
		super();
		try {
			// Attempt to parse eror as JSON (treat all fields as optional)
			this._err = <ErrorLike>JSON.parse(errText);
		} catch (e) {
			// If the error doesn't parse, maybe it's not JSON? (That's a
			// problem but we'll deal by showing it raw)
			logService.warn(`Not parseable as an error: ${errText}`);
			this._err = {
				message: errText,
				name: 'Error',
				stack: ''
			};
		}

		// Create the root render element (unattached until rendered)
		this._ele = document.createElement('div');
		this._ele.classList.add('repl-error');
	}

	/**
	 * Renders the error to HTML
	 *
	 * @param parentElement The parent element to render the error into
	 */
	render(parentElement: HTMLElement) {

		// Error name: this is defined by the executing kernel (example:
		// "NameError" for the Python kernel denotes the use of an undeclared
		// variable)
		if (this._err.name) {
			const name = document.createElement('div');
			name.classList.add('repl-error-name');
			name.innerText = this._err.name;
			this._ele.appendChild(name);
		}

		// Error message: full text of the error
		if (this._err.message) {
			const message = document.createElement('div');
			message.classList.add('repl-error-message');
			message.innerText = this._err.message;
			this._ele.appendChild(message);
		}

		// Error stack: backtrace
		if (this._err.stack) {
			const stack = document.createElement('div');
			stack.classList.add('repl-error-stack');
			stack.innerText = this._err.stack;
			this._ele.appendChild(stack);
		}

		parentElement.appendChild(this._ele);
	}

	/**
	 * Returns the DOM node that hosts the rendered error
	 */
	getDomNode(): HTMLElement {
		return this._ele;
	}
}
