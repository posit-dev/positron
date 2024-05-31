/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { WebFrameMain } from 'electron';
import { Emitter, Event } from 'vs/base/common/event';
import { WebviewFrame, WebviewFrameId } from 'vs/platform/webview/common/webviewManagerService';

export class ElectronWebviewFrame implements WebviewFrame {
	private _onDomReadyEmitter = new Emitter<void>();

	onDomReady: Event<void>;
	constructor(private readonly _frame: WebFrameMain) {
		this.onDomReady = this._onDomReadyEmitter.event;
		this._frame.on('dom-ready', () => this._onDomReadyEmitter.fire());
	}

	get frameId() {
		const frameId: WebviewFrameId = {
			processId: this._frame.processId,
			routingId: this._frame.routingId
		};
		return frameId;
	}

	executeJavaScript(code: string): Promise<any> {
		return this._frame.executeJavaScript(code);
	}
}
