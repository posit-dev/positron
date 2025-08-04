/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

export class DisposableStore implements vscode.Disposable {
	private _disposables = new Set<vscode.Disposable>();

	add<T extends vscode.Disposable>(disposable: T): T {
		this._disposables.add(disposable);
		return disposable;
	}

	dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}

		this._disposables.clear();
	}
}

export function formatDebugMessage(message: DebugProtocol.ProtocolMessage): string {
	switch (message.type) {
		case 'request': {
			const request = message as DebugProtocol.Request;
			return `${request.command} #${request.seq}: ${JSON.stringify(request.arguments)}`;
		}
		case 'event': {
			const event = message as DebugProtocol.Event;
			return `${event.event}: ${JSON.stringify(event.body)}`;
		}
		case 'response': {
			const response = message as DebugProtocol.Response;
			return `${response.command} #${response.request_seq}: ${JSON.stringify(response.body)}`;
		}
		default: {
			return `[${message.type}]: ${JSON.stringify(message)}`;
		}
	}
}
