/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { CellDebugController } from './cellDebugController.js';
import { createDebuggerOutputChannel, Disposable } from './util.js';
import { JupyterRuntimeDebugAdapter } from './jupyterRuntimeDebugAdapter.js';
import { PathEncoder } from './pathEncoder.js';
import { NotebookLocationMapper } from './notebookLocationMapper.js';

// TODO: How do we handle reusing a debug adapter/session across cells?
/**
 * Factory for creating debug adapters for notebook cell debugging.
 */
export class NotebookDebugAdapterFactory extends Disposable implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable {

	/* Maps runtime session IDs to their debug output channels. */
	private readonly _outputChannelByRuntimeSessionId = new Map<string, vscode.LogOutputChannel>();

	constructor() {
		super();
	}

	async createDebugAdapterDescriptor(debugSession: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | undefined> {
		const notebook = vscode.workspace.notebookDocuments.find(
			(doc) => doc.uri.toString() === debugSession.configuration.__notebookUri
		);
		if (!notebook) {
			return undefined;
		}

		const cell = notebook.getCells().find(
			(cell) => cell.document.uri.toString() === debugSession.configuration.__cellUri
		);
		if (!cell) {
			return undefined;
		}

		// TODO: A given runtime session can only have one debug session at a time...
		const runtimeSessions = await positron.runtime.getActiveSessions();
		const runtimeSession = runtimeSessions.find(
			(session) => session.metadata.notebookUri &&
				session.metadata.notebookUri.toString() === notebook.uri.toString()
		);
		if (!runtimeSession) {
			log.warn(`No runtime session found for notebook: ${notebook.uri}`);
			return undefined;
		}

		// Create the output channel for the runtime session's debugger.
		const outputChannel = this.createOutputChannel(runtimeSession);

		const sourceMapper = new PathEncoder();
		const mapper = this._register(new NotebookLocationMapper(sourceMapper, notebook));
		const adapter = this._register(new JupyterRuntimeDebugAdapter({
			mapper, outputChannel, debugSession, runtimeSession
		}));

		// TODO: Where should this disposable live?
		// TODO: Do we need a refresh state event or can we just call debugInfo here?
		this._register(adapter.onDidRefreshState((debugInfo) => {
			sourceMapper.setOptions({
				hashMethod: debugInfo.hashMethod,
				hashSeed: debugInfo.hashSeed,
				tmpFilePrefix: debugInfo.tmpFilePrefix,
				tmpFileSuffix: debugInfo.tmpFileSuffix,
			});
		}));

		// Create a debug cell manager to handle the cell execution and debugging.
		const debugCellManager = this._register(new CellDebugController(adapter, debugSession, runtimeSession, cell));

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
					debugCellManager.dispose();
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
