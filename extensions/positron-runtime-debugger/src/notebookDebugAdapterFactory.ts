/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugCellController } from './debugCellController.js';
import { createDebuggerOutputChannel, Disposable, DisposableStore, isUriEqual, ResourceSetContextKey } from './util.js';
import { RuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { PathEncoder } from './pathEncoder.js';
import { NotebookLocationMapper } from './notebookLocationMapper.js';
import { getNotebookSession } from './notebookDebugService.js';

/**
 * Factory for creating debug adapters for notebook cell debugging.
 */
export class NotebookDebugAdapterFactory extends Disposable implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable {

	/* Maps runtime session IDs to their debug output channels. */
	private readonly _outputChannelByRuntimeSessionId = new Map<string, vscode.LogOutputChannel>();

	private readonly _debuggedNotebookUris = new ResourceSetContextKey('debuggedNotebooks');

	async createDebugAdapterDescriptor(debugSession: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | undefined> {
		// NOTE: Errors thrown here are displayed to the user in a modal.

		const notebookUri = vscode.Uri.parse(debugSession.configuration.__notebookUri, true);
		if (this._debuggedNotebookUris.has(notebookUri)) {
			throw new Error(vscode.l10n.t('Unexpected error: Notebook {0} is already being debugged', notebookUri.toString()));
		}

		const notebook = vscode.workspace.notebookDocuments.find((doc) => isUriEqual(doc.uri, notebookUri));
		if (!notebook) {
			throw new Error(vscode.l10n.t('Unexpected error: Notebook {0} not found', notebookUri.toString()));
		}

		const cellUri = vscode.Uri.parse(debugSession.configuration.__cellUri, true);
		const cell = notebook.getCells().find((cell) => isUriEqual(cell.document.uri, cellUri));
		if (!cell) {
			throw new Error(vscode.l10n.t('Unexpected error: Cell {0} not found', cellUri.toString()));
		}

		const runtimeSession = await getNotebookSession(notebookUri);
		if (!runtimeSession) {
			throw new Error(vscode.l10n.t('Unexpected error: No active runtime session found for notebook {0}', notebook.uri.toString()));
		}

		const isPositronNotebook = Boolean(debugSession.configuration.__isPositron);

		// Create the debug adapter and its components.
		const disposables = this._register(new DisposableStore());
		const outputChannel = this.createOutputChannel(runtimeSession);
		const pathEncoder = new PathEncoder();
		const locationMapper = disposables.add(new NotebookLocationMapper(pathEncoder, notebook));
		const adapter = disposables.add(new RuntimeDebugAdapter({ locationMapper, outputChannel, pathEncoder, debugSession, runtimeSession }));

		disposables.add(new DebugCellController(adapter, debugSession, runtimeSession, cell, outputChannel, isPositronNotebook));

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
