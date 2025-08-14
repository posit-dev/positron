/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { ContextKey, Disposable } from './util.js';
import { NotebookDebugAdapterFactory } from './notebookDebugAdapterFactory.js';

const DebugCellCommand = 'notebook.debugCell';

const ActiveNotebookSupportsDebuggingContext = 'activeNotebookSupportsDebugging';

enum LanguageRuntimeSupportedFeature {
	Debugger = 'debugger',
}

/**
 * Service to manage debugging notebooks.
 */
export class NotebookDebugService extends Disposable {
	/**
	 * Context key to indicate if the active notebook's language runtime supports debugging.
	 */
	private readonly _activeNotebookSupportsDebugging = new ContextKey(ActiveNotebookSupportsDebuggingContext);

	constructor() {
		super();

		// Register the debug adapter factory for notebooks.
		const adapterFactory = this._register(new NotebookDebugAdapterFactory());
		this._register(vscode.debug.registerDebugAdapterDescriptorFactory('notebook', adapterFactory));

		// Register the command to debug a notebook cell.
		this._register(vscode.commands.registerCommand(DebugCellCommand, debugCell));

		// Update context key for notebook debugging support.
		this._register(vscode.window.onDidChangeActiveNotebookEditor(async (editor) => {
			this.updateActiveNotebookSupportsDebugging(editor);
		}));
		this.updateActiveNotebookSupportsDebugging(vscode.window.activeNotebookEditor);
	}

	private async updateActiveNotebookSupportsDebugging(editor: vscode.NotebookEditor | undefined): Promise<void> {
		let logPrefix = '[NotebookDebugService] onDidChangeActiveNotebookEditor';

		// Not a notebook editor.
		if (!editor) {
			log.debug(`${logPrefix}: No active notebook editor`);
			this._activeNotebookSupportsDebugging.set(false);
			return;
		}

		// Add the notebook URI to the log prefix.
		logPrefix += ` (${editor.notebook.uri.toString()})`;

		// Get the runtime session for the notebook.
		const runtimeSession = await getNotebookSession(editor.notebook.uri);

		// No active runtime session for the notebook.
		if (!runtimeSession) {
			log.debug(`${logPrefix}: No active runtime session`);
			this._activeNotebookSupportsDebugging.set(false);
			return;
		}

		let runtimeInfo = runtimeSession.runtimeInfo;

		// If there is no runtime info yet, wait for the runtime to start.
		if (!runtimeInfo) {
			log.debug(`${logPrefix}: No runtime info available, waiting for runtime to start`);

			// Disable the context key until we have runtime info.
			this._activeNotebookSupportsDebugging.set(false);

			// Wait for the runtime to become ready.
			runtimeInfo = await new Promise(resolve => {
				const disposable = this._register(runtimeSession.onDidChangeRuntimeState((state) => {
					if (state === positron.RuntimeState.Ready) {
						disposable.dispose();
						resolve(runtimeSession.runtimeInfo);
					}
				}));
			});

			// This shouldn't happen, log just in case.
			if (!runtimeInfo) {
				log.error(`${logPrefix} Unexpected error: No runtime info available for session: ${runtimeSession.metadata.sessionId}`);
				return;
			}
		}

		// Update the context key based on the runtime's supported features.
		const supportedFeatures = runtimeInfo?.supported_features ?? [];
		log.debug(`${logPrefix}: Runtime supports features: ${JSON.stringify(supportedFeatures)}`);
		this._activeNotebookSupportsDebugging.set(supportedFeatures.includes(LanguageRuntimeSupportedFeature.Debugger));
	}
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

		// It shouldn't be possible to call this command without a cell, log just in case.
		if (!cell) {
			log.error(`${DebugCellCommand} command called without a cell.`);
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
		__cellUri: cell.document.uri.toString(),
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

/** Get the language runtime session for a notebook. */
export async function getNotebookSession(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession | undefined> {
	const runtimeSessions = await positron.runtime.getActiveSessions();
	const runtimeSession = runtimeSessions.find(
		(session) => session.metadata.notebookUri &&
			session.metadata.notebookUri.toString() === notebookUri.toString()
	);
	return runtimeSession;
}
