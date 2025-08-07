/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebugProtocol } from '@vscode/debugprotocol';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DisposableStore } from './util.js';


export class CellDebugController implements vscode.Disposable {
	private readonly _disposables = new DisposableStore();

	private _executionId?: string;

	constructor(
		private readonly _adapter: vscode.DebugAdapter,
		private readonly _debugSession: vscode.DebugSession,
		private readonly _notebook: vscode.NotebookDocument,
		private readonly _runtimeSession: positron.LanguageRuntimeSession,
		private readonly _cellIndex: number
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
			if (event.attribution.source === positron.CodeAttributionSource.Notebook &&
				// TODO: what does this look like for untitled/unsaved files?
				event.attribution.metadata?.notebook === this._notebook.uri.fsPath) {
				executeDisposable.dispose();
				this._executionId = event.executionId;
			}
		}));

		// End the debug session when the cell execution is complete.
		const messageDisposable = this._disposables.add(this._runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
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

	dispose() {
		this._disposables.dispose();
	}
}
