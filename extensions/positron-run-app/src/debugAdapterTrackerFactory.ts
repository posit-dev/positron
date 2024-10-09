/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function registerDebugAdapterTrackerFactory(disposables: vscode.Disposable[]): DebugAdapterTrackerFactory {
	const factory = new DebugAdapterTrackerFactory();
	disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('*', factory));
	return factory;
}

/**
 * Event fired when a debug session requests to run a command in the terminal.
 */
export interface RequestRunInTerminalEvent {
	debugSession: vscode.DebugSession;
	processId: number;
}

/**
 * Watches for debug sessions requesting to run commands in the integrated integrated terminal.
 */
export class DebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory, vscode.Disposable {
	private readonly _disposables = new Array<vscode.Disposable>();

	private readonly _onDidRequestRunInTerminal = new vscode.EventEmitter<RequestRunInTerminalEvent>();

	/** Event fired when a debug session requests to run a command in the integrated terminal. */
	public readonly onDidRequestRunInTerminal = this._onDidRequestRunInTerminal.event;

	dispose() {
		this._disposables.forEach(disposable => disposable.dispose());
		this._onDidRequestRunInTerminal.dispose();
	}

	public createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
		const tracker = new DebugAdapterTracker();

		this._disposables.push(
			tracker,
			tracker.onDidRequestRunInTerminal(processId => {
				this._onDidRequestRunInTerminal.fire({ debugSession: session, processId });
			}),
		);

		return tracker;
	}
}

class DebugAdapterTracker implements vscode.DebugAdapterTracker, vscode.Disposable {
	private _runInTerminalRequestSeq?: number;

	private readonly _onDidRequestRunInTerminal = new vscode.EventEmitter<number>();

	/** Event fired when a debug session requests to run a command in the integrated terminal. */
	public readonly onDidRequestRunInTerminal = this._onDidRequestRunInTerminal.event;

	dispose() {
		this._onDidRequestRunInTerminal.dispose();
	}

	public onDidSendMessage(msg: any): void {
		// Listen for the debug adapter requesting to run a command in the integrated terminal.
		if (msg.type === 'request' &&
			msg.command === 'runInTerminal' &&
			msg.arguments &&
			msg.arguments.kind === 'integrated') {
			this._runInTerminalRequestSeq = msg.seq;
		}
	}

	public onWillReceiveMessage(msg: any): void {
		// Listen for the debug adapter receiving the response to the runInTerminal request.
		if (this._runInTerminalRequestSeq &&
			msg.type === 'response' &&
			msg.command === 'runInTerminal' &&
			msg.body &&
			msg.request_seq === this._runInTerminalRequestSeq) {
			this._runInTerminalRequestSeq = undefined;
			this._onDidRequestRunInTerminal.fire(msg.body.shellProcessId);
		}
	}
}
