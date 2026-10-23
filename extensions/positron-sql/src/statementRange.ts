/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { SqlAnalyzer, StatementSpan } from './analyzer';

/**
 * A StatementRangeProvider implementation for SQL.
 *
 * Positron asks for a statement range when the user runs code from a SQL editor without a
 * selection, so that the Console receives one whole statement rather than the line under the
 * cursor. The answer has to be returned right then, which is why the analyzer is a WebAssembly
 * module in this process rather than a language server: the real tokenizer can be asked the
 * question synchronously, on the keystroke, with no process to have started first.
 *
 * That is also what removed the hand written scanner this used to use. Splitting on top level
 * semicolons means knowing which parts of the text cannot hold one -- comments, string literals,
 * quoted identifiers, dollar quoted bodies -- and the tokenizer already knows, per dialect,
 * rather than approximately.
 */
export class SqlStatementRangeProvider implements positron.StatementRangeProvider {

	constructor(
		private readonly _analyzer: () => SqlAnalyzer,
		private readonly _dialect: () => string,
	) { }

	public provideStatementRange(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): positron.StatementRange | undefined {
		const text = document.getText();
		const statements = this._analyzer().statements(text, this._dialect());
		const statement = statementAt(text, statements, document.offsetAt(position));
		if (!statement) {
			return undefined;
		}

		// No `code` is returned: the statement is exactly the document text at this range, and
		// Positron falls back to that text when `code` is omitted.
		return {
			range: new vscode.Range(
				document.positionAt(statement.start),
				document.positionAt(statement.end),
			),
		};
	}
}

/**
 * The statement to run for a cursor position: the first one the cursor has not already passed.
 *
 * A cursor before or inside a statement runs that statement, so putting it on the comment above
 * one, or anywhere within it, does what the user means. The rest of the line after a statement
 * still counts as being in it when that is only spaces, tabs and comments, so a cursor at the end
 * of `SELECT 1; -- note` runs `SELECT 1`. Once the cursor is on the next line, the statement above
 * has been left behind, and there is nothing to run until the next one starts.
 */
export function statementAt(
	text: string,
	statements: readonly StatementSpan[],
	offset: number,
): StatementSpan | undefined {
	return statements.find(statement => offset <= endOfTrailingLine(text, statement.end));
}

/**
 * Where the spaces, tabs and comments that follow `offset` on its line end. A block comment only
 * counts when it closes on the same line: one that runs on to later lines is treated like those
 * lines, as leading up to the next statement.
 */
function endOfTrailingLine(text: string, offset: number): number {
	let at = offset;
	while (at < text.length) {
		if (text[at] === ' ' || text[at] === '\t') {
			at += 1;
		} else if (text.startsWith('--', at)) {
			const newline = text.indexOf('\n', at);
			return newline === -1 ? text.length : newline;
		} else if (text.startsWith('/*', at)) {
			const close = text.indexOf('*/', at + 2);
			const newline = text.indexOf('\n', at);
			if (close === -1 || (newline !== -1 && newline < close)) {
				return at;
			}
			at = close + 2;
		} else {
			return at;
		}
	}
	return at;
}
