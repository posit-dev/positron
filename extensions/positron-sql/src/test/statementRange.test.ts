/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';

suite('SqlStatementRangeProvider', () => {
	suiteSetup(async () => {
		// The provider is registered when the extension activates.
		await vscode.extensions.getExtension('positron.positron-sql')!.activate();
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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
