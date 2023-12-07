/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

import * as dtp from './positron-data-tool';

export class ZedDataToolSource {

	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	public readonly id: string;

	constructor(readonly title: string) {
		// Create a unique ID for this instance
		this.id = randomUUID();
	}

	handleMessage(message: any): void {
		switch (message.msg_type) {
			case 'ready':
			case 'schema':
				break;
			case 'data':
				break;
			case 'filter':
				break;
			case 'sort':
				break;
			case 'profile':
				break;
			case 'state':
				break;
			default:
				console.error(`ZedData ${this.id} got unknown message type: ${message.msg_type}`);
				break;
		}
	}
}
