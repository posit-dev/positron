/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RendererContext } from 'vscode-notebook-renderer';
import { Disposable } from 'vscode-notebook-renderer/events';
import { FromWebviewMessage, ToWebviewMessage } from '../../../src/vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';

/**
 * Typed messaging interface between the preload script and the main thread Positron IPyWidgets service.
 */
export class Messaging {
	constructor(private readonly _context: RendererContext<any>) { }

	/**
	 * Send a message to the main thread.
	 *
	 * @param message The message to send to the main thread.
	 */
	postMessage(message: FromWebviewMessage): void {
		if (!this._context.postMessage) {
			throw new Error('Messaging is not supported in this context.');
		}
		this._context.postMessage(message);
	}

	/**
	 * Register a listener for messages from the main thread.
	 *
	 * @param listener The listener to register.
	 * @returns A disposable that can be used to unregister the listener.
	 */
	onDidReceiveMessage(listener: (e: ToWebviewMessage) => any): Disposable {
		if (!this._context.onDidReceiveMessage) {
			throw new Error('Messaging is not supported in this context.');
		}
		return this._context.onDidReceiveMessage(listener as any);
	}
}
