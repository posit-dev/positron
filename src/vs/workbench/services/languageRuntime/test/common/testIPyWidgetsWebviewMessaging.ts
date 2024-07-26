/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IIPyWidgetsWebviewMessaging } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { FromWebviewMessage, ToWebviewMessage } from 'vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';

export class TestIPyWidgetsWebviewMessaging extends Disposable implements IIPyWidgetsWebviewMessaging {
	private readonly _messageEmitter = new Emitter<FromWebviewMessage>();

	readonly onDidReceiveMessage = this._messageEmitter.event;

	postMessage(message: ToWebviewMessage): void {
		this._postMessageEmitter.fire(message);
		this.messagesToWebview.push(message);
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
