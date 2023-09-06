/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { CancellationToken, LanguageClient, Position, Range, RequestType, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

interface StatementRangeParams {
	textDocument: VersionedTextDocumentIdentifier;
	position: Position;
}

interface StatementRangeResponse {
	range: Range;
}

export namespace StatementRangeRequest {
	export const type: RequestType<StatementRangeParams, StatementRangeResponse | undefined, any> = new RequestType('positron/textDocument/statementRange');
}

/**
 * A StatementRangeProvider implementation for R
 */
export class RStatementRangeProvider implements positron.StatementRangeProvider {

	/** The language client instance */
	private readonly _client: LanguageClient;

	constructor(
		readonly client: LanguageClient,
	) {
		this._client = client;
	}

	async provideStatementRange(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken): Promise<vscode.Range | undefined> {

		const params: StatementRangeParams = {
			textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
			position: this._client.code2ProtocolConverter.asPosition(position)
		};

		const response = this._client.sendRequest(StatementRangeRequest.type, params, token);

		return response.then(data => {
			return this._client.protocol2CodeConverter.asRange(data?.range);
		});
	}
}
