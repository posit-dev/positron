/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { LanguageClient, Position, Range, RequestType, ResponseError, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

interface StatementRangeParams {
	textDocument: VersionedTextDocumentIdentifier;
	position: Position;
}

interface StatementRangeResponse {
	range: Range;
	code?: string;
}

type StatementRangeError = StatementRangeParseError;

interface StatementRangeParseError {
	/**
	 * A 0-indexed line number where the parse error occurred.
	 */
	line: number;
}

const enum StatementRangeErrorCode {
	Parse = 1,
}

export namespace StatementRangeRequest {
	export const type: RequestType<StatementRangeParams, StatementRangeResponse | undefined, StatementRangeError> = new RequestType('positron/textDocument/statementRange');
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
		token: vscode.CancellationToken
	): Promise<positron.StatementRange | positron.StatementRangeError | undefined> {

		const params: StatementRangeParams = {
			textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
			position: this._client.code2ProtocolConverter.asPosition(position)
		};

		let data: StatementRangeResponse | undefined;

		try {
			data = await this._client.sendRequest(StatementRangeRequest.type, params, token);
		} catch (err) {
			// Try casting to known specific error type
			if (err instanceof ResponseError && err.code === StatementRangeErrorCode.Parse) {
				const errData = err.data as StatementRangeParseError;
				return {
					error: 'parse',
					line: errData.line,
				} satisfies positron.StatementRangeParseError;
			}

			// Otherwise rethrow the arbitrary error
			throw err;
		}

		if (!data) {
			return undefined;
		}

		const range = this._client.protocol2CodeConverter.asRange(data.range);
		// Explicitly normalize non-strings to `undefined` (i.e. a possible `null`)
		const code = typeof data.code === 'string' ? data.code : undefined;
		return { range: range, code: code } satisfies positron.StatementRange;
	}
}
