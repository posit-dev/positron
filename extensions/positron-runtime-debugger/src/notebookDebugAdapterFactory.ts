/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { DebugCellController } from './debugCellController.js';
import { ContextKey, createDebuggerOutputChannel, Disposable } from './util.js';
import { RuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { PathEncoder } from './pathEncoder.js';
import { NotebookLocationMapper } from './notebookLocationMapper.js';
import { getNotebookSession } from './notebookDebugService.js';

// TODO: How do we handle reusing a debug adapter/session across cells?
/**
 * Factory for creating debug adapters for notebook cell debugging.
 */
export class NotebookDebugAdapterFactory extends Disposable implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable {

	/* Maps runtime session IDs to their debug output channels. */
	private readonly _outputChannelByRuntimeSessionId = new Map<string, vscode.LogOutputChannel>();

	private readonly _notebookDebugDocuments = new ContextKey<vscode.Uri[]>('notebookDebugResources');

	constructor() {
		super();
	}

	async createDebugAdapterDescriptor(debugSession: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | undefined> {
		const notebookUri = vscode.Uri.parse(debugSession.configuration.__notebookUri, true);
		const notebook = vscode.workspace.notebookDocuments.find((doc) => doc.uri.toString() === notebookUri.toString());
		if (!notebook) {
			throw new Error(`Notebook not found: ${notebookUri}`);
		}

		const cellUri = vscode.Uri.parse(debugSession.configuration.__cellUri, true);
		const cell = notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri.toString());
		if (!cell) {
			throw new Error(`Cell not found: ${cellUri}`);
		}

		// TODO: A given runtime session can only have one debug session at a time...
		const runtimeSession = await getNotebookSession(notebookUri);
		if (!runtimeSession) {
			throw new Error(`No active runtime session found for notebook: ${notebook.uri}`);
		}

		// Create the output channel for the runtime session's debugger.
		const outputChannel = this.createOutputChannel(runtimeSession);

		const pathEncoder = new PathEncoder();
		const locationMapper = this._register(new NotebookLocationMapper(pathEncoder, notebook));
		const adapter = this._register(new RuntimeDebugAdapter({
			locationMapper, outputChannel, pathEncoder, debugSession, runtimeSession
		}));

		// Create a debug cell controller to handle the cell execution and debugging.
		const debugCellController = this._register(new DebugCellController(adapter, debugSession, runtimeSession, cell));

		// TODO: Move below to JupyterRuntimeDebugAdapter?
		// TODO: stop debugging when:
		// - runtime exits
		// - cell is deleted
		// - notebook is closed

		// End the debug session when the kernel is interrupted.
		const stateDisposable = this._register(runtimeSession.onDidChangeRuntimeState(async (state) => {
			console.log(`Runtime state changed: ${state}`);
			if (state === positron.RuntimeState.Interrupting) {
				stateDisposable.dispose();
				await vscode.debug.stopDebugging(debugSession);
			}
		}));

		// Clean up when the debug session terminates.
		this._register(
			vscode.debug.onDidTerminateDebugSession((session) => {
				if (session.id === debugSession.id) {
					stateDisposable.dispose();
					debugCellController.dispose();
					adapter.dispose();
				}
			})
		);

		return new vscode.DebugAdapterInlineImplementation(adapter);
	}

	private createOutputChannel(runtimeSession: positron.LanguageRuntimeSession): vscode.LogOutputChannel {
		const outputChannel = this._outputChannelByRuntimeSessionId.get(runtimeSession.metadata.sessionId);
		if (outputChannel) {
			return outputChannel;
		}
		const newOutputChannel = this._register(createDebuggerOutputChannel(runtimeSession));
		this._outputChannelByRuntimeSessionId.set(runtimeSession.metadata.sessionId, newOutputChannel);
		return newOutputChannel;
	}
}
