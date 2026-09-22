/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { LanguageClient, Position, Range, RequestType, State, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

enum StatementRangeKind {
	Success = 'success',
	Rejection = 'rejection'
}

enum StatementRangeRejectionKind {
	Syntax = 'syntax'
}

interface StatementRangeParams {
	textDocument: VersionedTextDocumentIdentifier;
	position: Position;
}

type StatementRangeResponse = StatementRangeSuccess | StatementRangeRejection;

interface StatementRangeSuccess {
	readonly kind: StatementRangeKind.Success;
	readonly range: Range;
	readonly code?: string;
}

type StatementRangeRejection = StatementRangeSyntaxRejection;

interface StatementRangeSyntaxRejection {
	readonly kind: StatementRangeKind.Rejection;
	readonly rejectionKind: StatementRangeRejectionKind.Syntax;
	readonly line?: number;
}

export namespace StatementRangeRequest {
	export const type: RequestType<StatementRangeParams, StatementRangeResponse | undefined, any> = new RequestType('positron/textDocument/statementRange');
}

/**
 * A StatementRangeProvider implementation for R
 */
export class RStatementRangeProvider implements positron.StatementRangeProvider {

	/**
	 * @param _shouldDecline Documents to answer `undefined` for, so that Positron
	 *   asks the next provider instead. The console client declines the Quarto
	 *   cells that a session of their own serves.
	 */
	constructor(
		private readonly _client: LanguageClient,
		private readonly _shouldDecline?: (document: vscode.TextDocument) => boolean,
	) { }

	async provideStatementRange(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<positron.StatementRange | undefined> {

		// A client keeps its registrations when it stops, and the registry asks
		// the newest first, so a stopped session is asked ahead of the console
		// client that can still answer. Decline rather than reject: a rejection
		// from a dead connection is noise every caller has to survive.
		if (this._client.state !== State.Running || this._shouldDecline?.(document)) {
			return undefined;
		}

		const params: StatementRangeParams = {
			textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
			position: this._client.code2ProtocolConverter.asPosition(position)
		};

		const data = await this._client.sendRequest(StatementRangeRequest.type, params, token);

		if (!data) {
			return undefined;
		}

		switch (data.kind) {
			case StatementRangeKind.Success: {
				return {
					range: this._client.protocol2CodeConverter.asRange(data.range),
					// Explicitly normalize non-strings to `undefined` (i.e. a possible `null`)
					code: typeof data.code === 'string' ? data.code : undefined
				} satisfies positron.StatementRange;
			}
			case StatementRangeKind.Rejection: {
				switch (data.rejectionKind) {
					case StatementRangeRejectionKind.Syntax: {
						throw new positron.StatementRangeSyntaxError(data.line);
					}
					default: {
						throw new Error(`Unrecognized 'StatementRangeRejectionKind': ${data.rejectionKind}`);
					}
				}
			}
			default: {
				throw new Error(`Unrecognized 'StatementRangeKind': ${data}`);
			}
		}
	}
}
