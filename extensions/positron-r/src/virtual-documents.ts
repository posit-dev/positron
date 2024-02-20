/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getRunningRRuntime } from './runtime';
import { ExecuteCommandRequest } from 'vscode-languageclient';

export const vdocProvider = new (class implements vscode.TextDocumentContentProvider {
	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const runtime = await getRunningRRuntime();
		const client = await runtime.lspClient();

		return await client.sendRequest(ExecuteCommandRequest.type, {
                    command: 'ark.internal.getVirtualDocument',
                    arguments: [
                            uri.path
                    ]
                });
	}
})();
