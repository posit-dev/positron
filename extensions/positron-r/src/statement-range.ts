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

type StatementRangeResponse = StatementRange | StatementRangeRejection;

interface StatementRange {
	/**
	 * The kind of statement range result. Always provided by Ark.
	 */
	readonly kind: 'success';

	/**
	 * The range of the statement at the given position.
	 */
	readonly range: Range;

	/**
	 * The code for this statement range, if different from the document contents at this range.
	 */
	readonly code?: string;
}

type StatementRangeRejection = StatementRangeParseRejection;

interface StatementRangeParseRejection {
	/**
	 * The kind of statement range result.
	 */
	readonly kind: 'rejection';

	/**
	 * The kind of rejection.
	 */
	readonly rejectionKind: 'parse';

	/**
	 * A 0-indexed line number where the parse error occurred.
	 */
	readonly line: number;
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
		token: vscode.CancellationToken
	): Promise<positron.StatementRange | positron.StatementRangeRejection | undefined> {

		const params: StatementRangeParams = {
			textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
			position: this._client.code2ProtocolConverter.asPosition(position)
		};

		let data = await this._client.sendRequest(StatementRangeRequest.type, params, token);

		if (!data) {
			return undefined;
		}

		switch (data.kind) {
			case 'success': {
				return {
					kind: data.kind,
					range: this._client.protocol2CodeConverter.asRange(data.range),
					// Explicitly normalize non-strings to `undefined` (i.e. a possible `null`)
					code: typeof data.code === 'string' ? data.code : undefined
				} satisfies positron.StatementRange;
			}
			case 'rejection': {
				switch (data.rejectionKind) {
					case 'parse': return {
						kind: data.kind,
						rejectionKind: data.rejectionKind,
						line: data.line
					} satisfies positron.StatementRangeParseRejection;
					default: {
						// Unknown `rejectionKind`
						return undefined;
					}
				}
			}
			default: {
				// Unknown `kind`
				return undefined;
			}
		}
	}
}
