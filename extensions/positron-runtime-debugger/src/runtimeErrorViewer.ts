/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Disposable } from './util.js';

/**
 * Command to show a runtime error to the user.
 *
 * Typically referenced in error messages from the runtime and reached via
 * a button in the error notification shown to the user.
 */
const ShowRuntimeErrorCommand = 'positron-runtime-debugger.showRuntimeError';

/**
 * Scheme used for displaying runtime errors in a read-only editor.
 */
const RuntimeErrorScheme = 'positron-runtime-debugger-runtime-error';

/**
 * Service to show runtime errors to the user.
 */
export class RuntimeErrorViewer extends Disposable {
	constructor() {
		super();

		const runtimeErrorContentProvider = new RuntimeErrorContentProvider();
		this._register(vscode.workspace.registerTextDocumentContentProvider(
			RuntimeErrorScheme,
			runtimeErrorContentProvider
		));

		this._register(vscode.commands.registerCommand(ShowRuntimeErrorCommand, showRuntimeError));
	}
}

/**
 * Displays a runtime error in a read-only editor.
 *
 * @param content The content of the error, for example a stack trace.
 */
async function showRuntimeError(content: string): Promise<void> {
	// The path has to be unique to avoid overwriting previous runtime errors.
	const timestamp = new Date().getTime();
	const path = `Runtime Error ${timestamp}`;
	const uri = vscode.Uri.from({
		scheme: RuntimeErrorScheme,
		path,
		query: content
	});
	await vscode.window.showTextDocument(uri);
}

/**
 * Simple content provider to display runtime errors in read-only editors.
 */
class RuntimeErrorContentProvider implements vscode.TextDocumentContentProvider {
	async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string | undefined> {
		return uri.query;
	}
}
