/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RequestType } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';

interface VirtualDocParams {
	path: string;
}

type VirtualDocResponse = string;

const VIRTUAL_DOC_REQUEST_TYPE: RequestType<VirtualDocParams, VirtualDocResponse, any> =
	new RequestType('ark/internal/getVirtualDocument');

export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider {
	constructor(private _client: LanguageClient) { }

	async provideTextDocumentContent(
		uri: vscode.Uri,
		token: vscode.CancellationToken
	): Promise<string> {
		const params: VirtualDocParams = {
			path: uri.path,
		};

		return await this._client.sendRequest(VIRTUAL_DOC_REQUEST_TYPE, params, token);
	}
}
