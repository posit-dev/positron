/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { DebugCellController } from './debugCellController.js';
import { ContextKey, createDebuggerOutputChannel, Disposable, DisposableStore, isUriEqual, ResourceSetContextKey } from './util.js';
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

	private readonly _debuggedNotebookUris = new ResourceSetContextKey('debuggedNotebooks');

	async createDebugAdapterDescriptor(debugSession: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | undefined> {
		const notebookUri = vscode.Uri.parse(debugSession.configuration.__notebookUri, true);

		if (this._debuggedNotebookUris.has(notebookUri)) {
			throw new Error(`Notebook is already being debugged: ${notebookUri}`);
		}

		const notebook = vscode.workspace.notebookDocuments.find((doc) => isUriEqual(doc.uri, notebookUri));
		if (!notebook) {
			throw new Error(`Notebook not found: ${notebookUri}`);
		}

		const cellUri = vscode.Uri.parse(debugSession.configuration.__cellUri, true);
		const cell = notebook.getCells().find((cell) => isUriEqual(cell.document.uri, cellUri));
		if (!cell) {
			throw new Error(`Cell not found: ${cellUri}`);
		}

		// TODO: Don't allow multiple debug sessions for the same notebook.
		const runtimeSession = await getNotebookSession(notebookUri);
		if (!runtimeSession) {
			throw new Error(`No active runtime session found for notebook: ${notebook.uri}`);
		}

		// Create the debug adapter and its components.
		const disposables = this._register(new DisposableStore());
		const outputChannel = this.createOutputChannel(runtimeSession);
		const pathEncoder = new PathEncoder();
		const locationMapper = disposables.add(new NotebookLocationMapper(pathEncoder, notebook));
		const adapter = disposables.add(new RuntimeDebugAdapter({ locationMapper, outputChannel, pathEncoder, debugSession, runtimeSession }));

		disposables.add(new DebugCellController(adapter, debugSession, runtimeSession, cell));

		// Track that the notebook is being debugged.
		await this._debuggedNotebookUris.add(notebookUri);

		// Clean up when the debug session terminates.
		disposables.add(vscode.debug.onDidTerminateDebugSession(async (session) => {
			if (session.id === debugSession.id) {
				await this._debuggedNotebookUris.delete(notebookUri);
				disposables.dispose();
			}
		}));

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
