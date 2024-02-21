/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ExecuteCommandRequest } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';

export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider {
	constructor(private _client: LanguageClient) {}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		return await this._client.sendRequest(ExecuteCommandRequest.type, {
                    command: 'ark.internal.getVirtualDocument',
                    arguments: [
                            uri.path
                    ]
                });
	}
}
