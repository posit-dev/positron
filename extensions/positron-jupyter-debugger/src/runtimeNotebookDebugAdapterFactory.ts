/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { DebugCellManager } from './notebook.js';
import { DisposableStore } from './util.js';
import { JupyterRuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { JupyterRuntimeNotebookDebugAdapter } from './runtimeNotebookDebugAdapter.js';

const DEBUGGER_OUTPUT_CHANNEL_DESCRIPTOR = vscode.l10n.t('Debugger');

// TODO: How do we handle reusing a debug adapter/session across cells?
export class RuntimeNotebookDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable {
	private readonly _disposables = new DisposableStore();

	private readonly _outputChannelByRuntimeSessionId = new Map<string, vscode.LogOutputChannel>();

	async createDebugAdapterDescriptor(debugSession: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable) {
		const notebook = vscode.workspace.notebookDocuments.find(
			(doc) => doc.uri.toString() === debugSession.configuration.__notebookUri
		);
		if (!notebook) {
			return undefined;
		}

		const cell = typeof debugSession.configuration.__cellIndex === 'number' &&
			notebook.cellAt(debugSession.configuration.__cellIndex);
		if (!cell) {
			return undefined;
		}

		// TODO: A given runtime session can only have one debug session at a time...
		const runtimeSessions = await positron.runtime.getActiveSessions();
		const runtimeSession = runtimeSessions.find(
			(session) => session.metadata.notebookUri &&
				session.metadata.notebookUri.toString() === debugSession.configuration.__notebookUri
		);
		if (!runtimeSession) {
			log.warn(`No runtime session found for notebook: ${notebook.uri}`);
			return undefined;
		}

		// Create the output channel for the runtime session's debugger.
		const outputChannel = this.createDebugAdapterOutputChannel(runtimeSession);

		// TODO: Remove
		// const runtimeSession = await positron.runtime.getNotebookSession(notebook.uri);
		// if (!runtimeSession) {
		// 	return undefined;
		// }
		// Create a new debug adapter for the notebook.
		// TODO: Reuse adapter if it already exists for the notebook?
		// const adapter = this._disposables.add(new RuntimeNotebookDebugAdapter(debugSession, runtimeSession, notebook));
		const innerAdapter = this._disposables.add(new JupyterRuntimeDebugAdapter(outputChannel, debugSession, runtimeSession));
		const adapter = this._disposables.add(new JupyterRuntimeNotebookDebugAdapter(innerAdapter, notebook));

		// Create a debug cell manager to handle the cell execution and debugging.
		const debugCellManager = this._disposables.add(new DebugCellManager(adapter, debugSession, notebook, runtimeSession, cell.index));

		// End the debug session when the kernel is interrupted.
		const stateDisposable = this._disposables.add(runtimeSession.onDidChangeRuntimeState(async (state) => {
			console.log(`Runtime state changed: ${state}`);
			if (state === positron.RuntimeState.Interrupting) {
				stateDisposable.dispose();
				await vscode.debug.stopDebugging(debugSession);
			}
		}));

		// Clean up when the debug session terminates.
		this._disposables.add(
			vscode.debug.onDidTerminateDebugSession((session) => {
				if (session.id === debugSession.id) {
					stateDisposable.dispose();
					debugCellManager.dispose();
					adapter.dispose();
				}
			})
		);

		return new vscode.DebugAdapterInlineImplementation(adapter);
	}

	private createDebugAdapterOutputChannel(runtimeSession: positron.LanguageRuntimeSession): vscode.LogOutputChannel {
		let outputChannel = this._outputChannelByRuntimeSessionId.get(runtimeSession.metadata.sessionId);

		if (!outputChannel) {
			const runtimeName = runtimeSession.runtimeMetadata.runtimeName;
			const sessionMode = runtimeSession.metadata.sessionMode;
			let sessionTitle: string;
			if (runtimeSession.metadata.notebookUri) {
				sessionTitle = path.basename(runtimeSession.metadata.notebookUri.fsPath);
			} else {
				sessionTitle = sessionMode.charAt(0).toUpperCase() + sessionMode.slice(1);
			}
			const name = `${runtimeName}: ${DEBUGGER_OUTPUT_CHANNEL_DESCRIPTOR} (${sessionTitle})`;
			outputChannel = this._disposables.add(vscode.window.createOutputChannel(name, { log: true }));
			this._outputChannelByRuntimeSessionId.set(runtimeSession.metadata.sessionId, outputChannel);
		}

		return outputChannel;
	}

	dispose() {
		this._disposables.dispose();
	}
}
