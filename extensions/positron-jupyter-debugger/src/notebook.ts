/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { DisposableStore } from './util.js';
import { Command } from './constants.js';
import { RuntimeNotebookDebugAdapterFactory } from './runtimeNotebookDebugAdapterFactory.js';
import { DebugProtocol } from '@vscode/debugprotocol';

export class DebugCellManager implements vscode.Disposable {
	private readonly _disposables = new DisposableStore();

	private _executionId?: string;

	constructor(
		private readonly _adapter: vscode.DebugAdapter,
		private readonly _debugSession: vscode.DebugSession,
		private readonly _notebook: vscode.NotebookDocument,
		private readonly _runtimeSession: positron.LanguageRuntimeSession,
		private readonly _cellIndex: number,
	) {
		// TODO: Check that the cell belongs to the notebook? Or pass in cell index?

		// Execute the cell when the debug session is ready.
		// TODO: If we attach to an existing debug session, would this work?
		//       Or we could also track configuration completed state in an adapter property
		const configDisposable = this._disposables.add(this._adapter.onDidSendMessage(async (message) => {
			if ((message as DebugProtocol.ProtocolMessage).type !== 'response' ||
				(message as DebugProtocol.Response).command !== 'configurationDone') {
				return;
			}

			configDisposable.dispose();

			// TODO: Is this right? Should we dump all cells?
			//       We have to at least dump this cell so that if a called function in another cell has a breakpoint,
			//       this cell can still be referenced e.g. in the stack trace.
			// TODO: Take cell as arg?
			// const cell = this._notebook.cellAt(this._cellIndex);
			// this._adapter.dumpCell(cell).catch((error) => {
			// 	log.error(`Error dumping cell ${cell.index}:`, error);
			// });

			// TODO: Can this throw?
			await vscode.commands.executeCommand('notebook.cell.execute', {
				ranges: [{ start: this._cellIndex, end: this._cellIndex + 1 }],
				document: this._notebook.uri,
			});
		}));

		// Track the runtime execution ID when the cell is executed.
		const executeDisposable = this._disposables.add(positron.runtime.onDidExecuteCode((event) => {
			// TODO: restrict to cell and session ID as well?
			if (
				event.attribution.source === positron.CodeAttributionSource.Notebook &&
				// TODO: what does this look like for untitled/unsaved files?
				event.attribution.metadata?.notebook === this._notebook.uri.fsPath
			) {
				executeDisposable.dispose();
				this._executionId = event.executionId;
			}
		}));

		// End the debug session when the cell execution is complete.
		const messageDisposable = this._disposables.add(this._runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
			// TODO: Throw or wait if execution ID is not set?
			if (
				this._executionId &&
				message.parent_id === this._executionId &&
				message.type === positron.LanguageRuntimeMessageType.State &&
				(message as positron.LanguageRuntimeState).state === positron.RuntimeOnlineState.Idle
			) {
				messageDisposable.dispose();
				await vscode.debug.stopDebugging(this._debugSession);
				// TODO: this.dispose()? Or ensure its disposed elsewhere?
			}
		}));
	}

	dispose() {
		this._disposables.dispose();
	}
}

export function activateRuntimeNotebookDebugging(): vscode.Disposable {
	const disposables = new DisposableStore();

	const adapterFactory = disposables.add(new RuntimeNotebookDebugAdapterFactory());
	disposables.add(vscode.debug.registerDebugAdapterDescriptorFactory('notebook', adapterFactory));

	disposables.add(vscode.commands.registerCommand(Command.DebugCell, debugCell));

	return disposables;
}

/**
 * Debug a notebook cell.
 *
 * @param cell The notebook cell to debug. If undefined, the active cell will be used.
 */
async function debugCell(cell: vscode.NotebookCell | undefined): Promise<void> {
	// This command can be called from:
	// 1. A cell's execute menu (`cell` is defined).
	// 2. The command palette (`cell` is undefined).

	// If no cell is provided, use the selected cell.
	if (!cell) {
		cell = getActiveNotebookCell();

		// If no cell is selected, log a warning and return.
		if (!cell) {
			// TODO: Should we show a notification instead?
			log.warn(`${Command.DebugCell} command called without a cell.`);
			return;
		}
	}

	// Start a debug session for the cell.
	// This will, in turn, create a debug adapter for the notebook using the factory defined above.
	await vscode.debug.startDebugging(undefined, {
		type: 'notebook',
		name: path.basename(cell.notebook.uri.fsPath),
		request: 'attach',
		// TODO: Get from config.
		justMyCode: true,
		__notebookUri: cell.notebook.uri.toString(),
		__cellIndex: cell.index,
	});
}

/** Get the active notebook cell, if one exists. */
function getActiveNotebookCell(): vscode.NotebookCell | undefined {
	const editor = vscode.window.activeNotebookEditor;
	if (editor) {
		const range = editor.selections[0];
		if (range) {
			return editor.notebook.cellAt(range.start);
		}
	}
	return undefined;
}
