/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IIPyWidgetsWebviewMessaging } from '../../common/languageRuntimeIPyWidgetClient.js';
import { FromWebviewMessage, ToWebviewMessage } from '../../common/positronIPyWidgetsWebviewMessages.js';

export class TestIPyWidgetsWebviewMessaging extends Disposable implements IIPyWidgetsWebviewMessaging {
	private readonly _messageEmitter = new Emitter<FromWebviewMessage>();

	readonly onDidReceiveMessage = this._messageEmitter.event;

	postMessage(message: ToWebviewMessage): Promise<boolean> {
		this._postMessageEmitter.fire(message);
		this.messagesToWebview.push(message);
		return Promise.resolve(true);
	}

	// Test helpers

	/** Record messages sent to the webview. */
	readonly messagesToWebview = new Array<ToWebviewMessage>();

	/** Fire the onDidReceiveMessage event. */
	receiveMessage(message: FromWebviewMessage): void {
		this._messageEmitter.fire(message);
	}

	private readonly _postMessageEmitter = new Emitter<ToWebviewMessage>();

	/** Emitted when the postMessage method is called. */
	readonly onDidPostMessage = this._postMessageEmitter.event;
}
