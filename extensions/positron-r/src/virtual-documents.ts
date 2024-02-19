/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getRunningRRuntime } from './runtime';


export const vdocProvider = new (class implements vscode.TextDocumentContentProvider {
	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const _runtime = await getRunningRRuntime();

		return Promise.resolve(`Requesting: ${uri.scheme} ${uri.path}`);
	}
})();
