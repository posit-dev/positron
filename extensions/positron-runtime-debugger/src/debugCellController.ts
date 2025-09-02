/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Disposable, isUriEqual } from './util.js';
import { assertDebugMessage, isDebugResponse } from './debugProtocol.js';

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
		private readonly _log: vscode.LogOutputChannel,
		private readonly _isPositronNotebook: boolean,
	) {
		super();

		// Execute the cell when the debug session has completed configuration.
		const configurationDone = this._register(this._adapter.onDidSendMessage(async (message) => {
			assertDebugMessage(message, this._log, '[debugCellController]');
			if (isDebugResponse(message, 'configurationDone')) {
				configurationDone.dispose();
				if (this._isPositronNotebook) {
					await vscode.commands.executeCommand('positronNotebook.cell.executeAndFocusContainer', {
						ranges: [{ start: this._cell.index, end: this._cell.index + 1 }],
						document: this._cell.notebook.uri,
					});
				} else {
					await vscode.commands.executeCommand('notebook.cell.execute', {
						ranges: [{ start: this._cell.index, end: this._cell.index + 1 }],
						document: this._cell.notebook.uri,
					});
				}
			}
		}));

		// Track the runtime execution ID when the cell is first executed.
		const execute = this._register(positron.runtime.onDidExecuteCode((event) => {
			if (event.attribution.source === positron.CodeAttributionSource.Notebook &&
				event.attribution.metadata?.cell?.uri !== undefined &&
				isUriEqual(event.attribution.metadata.cell.uri, this._cell.document.uri)) {
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
			if (isUriEqual(event.notebook.uri, this._cell.notebook.uri)) {
				for (const change of event.contentChanges) {
					for (const cell of change.removedCells) {
						if (isUriEqual(cell.document.uri, this._cell.document.uri)) {
							cellDeleted.dispose();
							await vscode.debug.stopDebugging(this._debugSession);
						}
					}
				}
			}
		}));

		// Stop debugging when the notebook is closed.
		const notebookClosed = this._register(vscode.workspace.onDidCloseNotebookDocument(async notebook => {
			if (isUriEqual(notebook.uri, this._cell.notebook.uri)) {
				notebookClosed.dispose();
				await vscode.debug.stopDebugging(this._debugSession);
			}
		}));
	}
}
