/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DEBUGGER_OUTPUT_CHANNEL_DESCRIPTOR } from './constants.js';

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

export function disposableTimeout(handler: () => void, timeout: number): vscode.Disposable {
	const timer = setTimeout(() => {
		handler();
	}, timeout);
	const disposable: vscode.Disposable = {
		dispose() {
			clearTimeout(timer);
		}
	};
	return disposable;
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

export function createDebugAdapterOutputChannel(runtimeSession: positron.LanguageRuntimeSession): vscode.LogOutputChannel {
	const runtimeName = runtimeSession.runtimeMetadata.runtimeName;
	const sessionMode = runtimeSession.metadata.sessionMode;
	let sessionTitle: string;
	if (runtimeSession.metadata.notebookUri) {
		sessionTitle = path.basename(runtimeSession.metadata.notebookUri.fsPath);
	} else {
		sessionTitle = sessionMode.charAt(0).toUpperCase() + sessionMode.slice(1);
	}
	const name = `${runtimeName}: ${DEBUGGER_OUTPUT_CHANNEL_DESCRIPTOR} (${sessionTitle})`;
	const outputChannel = vscode.window.createOutputChannel(name, { log: true });
	return outputChannel;
}
