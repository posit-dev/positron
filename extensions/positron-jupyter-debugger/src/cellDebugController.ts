/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Disposable } from './util.js';

/**
 * Controls the execution and lifecycle of a notebook cell during debugging.
 */
export class CellDebugController extends Disposable implements vscode.Disposable {
	/* Tracks the runtime execution ID of the current cell. */
	private _executionId?: string;

	constructor(
		private readonly _adapter: vscode.DebugAdapter,
		private readonly _debugSession: vscode.DebugSession,
		private readonly _runtimeSession: positron.LanguageRuntimeSession,
		private readonly _cell: vscode.NotebookCell,
	) {
		super();

		// Execute the cell when the debug session has completed configuration.
		const configurationDoneDisposable = this._register(this._adapter.onDidSendMessage(async (message) => {
			if ((message as DebugProtocol.ProtocolMessage).type !== 'response' ||
				(message as DebugProtocol.Response).command !== 'configurationDone') {
				return;
			}

			configurationDoneDisposable.dispose();

			await vscode.commands.executeCommand('notebook.cell.execute', {
				ranges: [{ start: this._cell.index, end: this._cell.index + 1 }],
				document: this._cell.notebook.uri,
			});
		}));

		// Track the runtime execution ID when the cell is first executed.
		const executeDisposable = this._register(positron.runtime.onDidExecuteCode((event) => {
			// TODO: restrict to cell and session ID as well?
			if (event.attribution.source === positron.CodeAttributionSource.Notebook &&
				// TODO: what does this look like for untitled/unsaved files?
				event.attribution.metadata?.notebook === this._cell.notebook.uri.fsPath) {
				executeDisposable.dispose();
				this._executionId = event.executionId;
			}
		}));

		// End the debug session when the cell execution is complete.
		const messageDisposable = this._register(this._runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
			// TODO: Throw or wait if execution ID is not set?
			if (this._executionId &&
				message.parent_id === this._executionId &&
				message.type === positron.LanguageRuntimeMessageType.State &&
				(message as positron.LanguageRuntimeState).state === positron.RuntimeOnlineState.Idle) {
				messageDisposable.dispose();
				await vscode.debug.stopDebugging(this._debugSession);
				// TODO: this.dispose()? Or ensure its disposed elsewhere?
			}
		}));
	}
}
