/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { StatementSpan } from '../analyzer';
import { statementsFromLine, statementsToLine } from '../statementRange';

suite('SqlStatementRangeProvider', () => {
	suiteSetup(async () => {
		// The provider is registered once the extension is active and `sql.enabled` is on.
		await vscode.extensions.getExtension('positron.positron-sql')!.activate();
		await setEnabled(true);
	});

	suiteTeardown(async () => {
		await setEnabled(undefined);
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('not registered while sql.enabled is off', async () => {
		await setEnabled(false);
		try {
			const result = await getStatementRange('SELECT 1;\n', new vscode.Position(0, 3));

			assert.strictEqual(result, undefined);
		} finally {
			await setEnabled(true);
		}
	});

	test('registered for SQL documents', async () => {
		const result = await getStatementRange('SELECT 1;\n', new vscode.Position(0, 3));

		assert.ok(result, 'Expected a statement range result');
		assertRangeEqual(result.range, 0, 0, 0, 9);
	});

	test('range spans a multi-line statement', async () => {
		const code = `SELECT *
FROM users
WHERE id = 1;
`;

		const result = await getStatementRange(code, new vscode.Position(1, 2));

		assert.ok(result, 'Expected a statement range result');
		assertRangeEqual(result.range, 0, 0, 2, 13);
	});

	test('a cursor on a comment line selects the next statement', async () => {
		const code = `-- list the users
SELECT 1;
`;

		const result = await getStatementRange(code, new vscode.Position(0, 0));

		assert.ok(result, 'Expected a statement range result');
		assertRangeEqual(result.range, 1, 0, 1, 9);
	});

	test('a cursor after a trailing comment selects the statement on its line', async () => {
		const code = `SELECT 1; /* one */ -- note
SELECT 2;
`;

		const result = await getStatementRange(code, new vscode.Position(0, 27));

		assert.ok(result, 'Expected a statement range result');
		assertRangeEqual(result.range, 0, 0, 0, 9);
	});

	test('a cursor at a statement on the same line as another selects it', async () => {
		const result = await getStatementRange('SELECT 1; SELECT 2;\n', new vscode.Position(0, 10));

		assert.ok(result, 'Expected a statement range result');
		assertRangeEqual(result.range, 0, 10, 0, 19);
	});

	test('a trailing comment is read in the dialect', async () => {
		// `#` comments a line in MySQL, so a cursor in one is still at the statement before it.
		await setDialect('mysql');
		try {
			const result = await getStatementRange('SELECT `a;b` FROM t; # comment ; here\nSELECT 2;\n', new vscode.Position(0, 30));

			assert.ok(result, 'Expected a statement range result');
			assertRangeEqual(result.range, 0, 0, 0, 20);
		} finally {
			await setDialect(undefined);
		}
	});

	test('no result past the last statement', async () => {
		const result = await getStatementRange('SELECT 1;\n\n', new vscode.Position(2, 0));

		assert.strictEqual(result, undefined);
	});

	test('not registered for other languages', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'SELECT 1;' });
		await vscode.window.showTextDocument(document);

		const result = await vscode.commands.executeCommand<positron.StatementRange | undefined>(
			'vscode.executeStatementRangeProvider',
			document.uri,
			new vscode.Position(0, 0)
		);

		assert.strictEqual(result, undefined);
	});
});

suite('statementsToLine and statementsFromLine', () => {

	const text = 'SELECT 1;\nSELECT 2,\n  3;\nSELECT 4;\n';
	const one = span(text, 'SELECT 1;');
	const two = span(text, 'SELECT 2,\n  3;');
	const four = span(text, 'SELECT 4;');
	const statements = [one, two, four];

	test('to a line runs each statement that starts by its end, whole', () => {
		// The second statement starts on line 1 and ends on line 2; it is not cut at line 1.
		assert.deepStrictEqual(statementsToLine(statements, lineEnd(text, 1)), [one, two]);
		assert.deepStrictEqual(statementsToLine(statements, lineEnd(text, 0)), [one]);
	});

	test('from a line runs each statement that ends after its start, whole', () => {
		// Line 2 is the end of the second statement, which runs from where it starts on line 1.
		assert.deepStrictEqual(statementsFromLine(statements, lineStart(text, 2)), [two, four]);
		assert.deepStrictEqual(statementsFromLine(statements, lineStart(text, 3)), [four]);
	});

	test('nothing from the blank line after the last statement', () => {
		assert.deepStrictEqual(statementsFromLine(statements, lineStart(text, 4)), []);
	});
});

/** The span of a statement as the analyzer would report it, found by its text. */
function span(text: string, statement: string): StatementSpan {
	const start = text.indexOf(statement);
	const end = start + statement.length;
	return { start, end, terminated: true, trailingEnd: end };
}

function lineStart(text: string, line: number): number {
	return text.split('\n').slice(0, line).reduce((offset, previous) => offset + previous.length + 1, 0);
}

function lineEnd(text: string, line: number): number {
	return lineStart(text, line) + text.split('\n')[line].length;
}

/** Sets `sql.enabled` for the user, or clears it with `undefined`. */
async function setEnabled(enabled: boolean | undefined): Promise<void> {
	await vscode.workspace.getConfiguration('sql').update('enabled', enabled, vscode.ConfigurationTarget.Global);
}

/** Sets `sql.dialect` for the user, or clears it with `undefined`. */
async function setDialect(dialect: string | undefined): Promise<void> {
	await vscode.workspace.getConfiguration('sql').update('dialect', dialect, vscode.ConfigurationTarget.Global);
}

/**
 * Executes the statement range provider for a SQL document with the given
 * contents at the given position.
 */
async function getStatementRange(
	content: string,
	position: vscode.Position
): Promise<positron.StatementRange | undefined> {
	const document = await vscode.workspace.openTextDocument({ language: 'sql', content });
	await vscode.window.showTextDocument(document);

	return await vscode.commands.executeCommand<positron.StatementRange | undefined>(
		'vscode.executeStatementRangeProvider',
		document.uri,
		position
	);
}

function assertRangeEqual(
	range: vscode.Range,
	startLine: number,
	startCharacter: number,
	endLine: number,
	endCharacter: number
): void {
	assert.strictEqual(range.start.line, startLine, 'start line');
	assert.strictEqual(range.start.character, startCharacter, 'start character');
	assert.strictEqual(range.end.line, endLine, 'end line');
	assert.strictEqual(range.end.character, endCharacter, 'end character');
}
