/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RequestType } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';

interface VirtualDocumentParams {
	path: string;
}

type VirtualDocResponse = string;

const VIRTUAL_DOCUMENT_REQUEST_TYPE: RequestType<VirtualDocumentParams, VirtualDocResponse, any> =
	new RequestType('ark/internal/virtualDocument');

export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider {
	constructor(private _client: LanguageClient) { }

	async provideTextDocumentContent(
		uri: vscode.Uri,
		token: vscode.CancellationToken
	): Promise<string> {
		const params: VirtualDocumentParams = {
			path: uri.path,
		};

		return await this._client.sendRequest(VIRTUAL_DOCUMENT_REQUEST_TYPE, params, token);
	}
}
