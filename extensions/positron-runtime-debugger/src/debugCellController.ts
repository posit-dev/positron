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
export class DebugCellController extends Disposable {
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
		const configurationDone = this._register(this._adapter.onDidSendMessage(async (message) => {
			if ((message as DebugProtocol.ProtocolMessage).type === 'response' &&
				(message as DebugProtocol.Response).command === 'configurationDone') {
				configurationDone.dispose();
				await vscode.commands.executeCommand('notebook.cell.execute', {
					ranges: [{ start: this._cell.index, end: this._cell.index + 1 }],
					document: this._cell.notebook.uri,
				});
			}
		}));

		// Track the runtime execution ID when the cell is first executed.
		const execute = this._register(positron.runtime.onDidExecuteCode((event) => {
			if (event.attribution.source === positron.CodeAttributionSource.Notebook &&
				event.attribution.metadata?.notebook === this._cell.notebook.uri.fsPath) {
				execute.dispose();
				this._executionId = event.executionId;
			}
		}));

		// Stop debugging when the cell execution is complete.
		const executeComplete = this._register(this._runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
			if (this._executionId &&
				message.parent_id === this._executionId &&
				message.type === positron.LanguageRuntimeMessageType.State &&
				(message as positron.LanguageRuntimeState).state === positron.RuntimeOnlineState.Idle) {
				executeComplete.dispose();
				await vscode.debug.stopDebugging(this._debugSession);
			}
		}));

		// Stop debugging when the cell is deleted.
		const cellDeleted = this._register(vscode.workspace.onDidChangeNotebookDocument(async event => {
			if (event.notebook.uri.toString() === this._cell.notebook.uri.toString()) {
				for (const change of event.contentChanges) {
					for (const cell of change.removedCells) {
						if (cell.document.uri.toString() === this._cell.document.uri.toString()) {
							cellDeleted.dispose();
							await vscode.debug.stopDebugging(this._debugSession);
						}
					}
				}
			}
		}));

		// Stop debugging when the notebook is closed.
		const notebookClosed = this._register(vscode.workspace.onDidCloseNotebookDocument(async notebook => {
			if (notebook.uri.toString() === this._cell.notebook.uri.toString()) {
				notebookClosed.dispose();
				await vscode.debug.stopDebugging(this._debugSession);
			}
		}));
	}
}
