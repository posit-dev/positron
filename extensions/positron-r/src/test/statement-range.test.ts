/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as testKit from './kit';
import { createRandomFile, deleteFile } from './editor-utils';

suite('RStatementRangeProvider', () => {
	let sessionDisposable: vscode.Disposable;

	suiteSetup(async function () {
		const [, disposable] = await testKit.startR();
		sessionDisposable = disposable;
	});

	suiteTeardown(async () => {
		await sessionDisposable?.dispose();
	});

	test('single-line expression', async function () {
		const code = `
1 + 1
`.trimStart();

		await testKit.withDisposables(async (disposables) => {
			const result = await getStatementRange(
				disposables,
				code,
				new vscode.Position(0, 0)
			);
			assert.ok(result, 'Expected a statement range result');
			assert.strictEqual(result.range.start.line, 0);
			assert.strictEqual(result.range.start.character, 0);
			assert.strictEqual(result.range.end.line, 0);
			assert.strictEqual(result.range.end.character, 5);
		});
	});

	test('multi-line block from first line', async function () {
		const code = `
for (i in 1:3) {
	print(i)
}
`.trimStart();

		await testKit.withDisposables(async (disposables) => {
			const result = await getStatementRange(
				disposables,
				code,
				new vscode.Position(0, 0)
			);

			assert.ok(result, 'Expected a statement range result');
			assert.strictEqual(result.range.start.line, 0);
			assert.strictEqual(result.range.start.character, 0);
			assert.strictEqual(result.range.end.line, 2);
			assert.strictEqual(result.range.end.character, 1);
		});
	});

	test('in a pipe chain', async function () {
		const code = `
1 + 1

df |>
	mutate(y = x + 1) |>
	mutate(z = x + y)
`.trimStart();

		await testKit.withDisposables(async (disposables) => {
			const result = await getStatementRange(
				disposables,
				code,
				new vscode.Position(3, 3)
			);

			assert.ok(result, 'Expected a statement range result');
			assert.strictEqual(result.range.start.line, 2);
			assert.strictEqual(result.range.start.character, 0);
			assert.strictEqual(result.range.end.line, 4);
			assert.strictEqual(result.range.end.character, 18);
		});
	});

	test('cursor before syntax error works fine', async function () {
		const code = `
df |>
	summarise(foo = mean(x))

df |>
	mutate(y = x \ 1 |>
	mutate(z = x + y)
`.trimStart();

		await testKit.withDisposables(async (disposables) => {
			const result = await getStatementRange(
				disposables,
				code,
				new vscode.Position(1, 3)
			);

			assert.ok(result, 'Expected a statement range result');
			assert.strictEqual(result.range.start.line, 0);
			assert.strictEqual(result.range.start.character, 0);
			assert.strictEqual(result.range.end.line, 1);
			assert.strictEqual(result.range.end.character, 25);
		});
	});

	test('cursor in syntax error throws StatementRangeSyntaxError', async function () {
		const code = `
df |>
	summarise(foo = mean(x))

df |>
	mutate(y = x \ 1 |>
	mutate(z = x + y)
`.trimStart();

		await testKit.withDisposables(async (disposables) => {
			await assert.rejects(
				() => getStatementRange(
					disposables,
					code,
					new vscode.Position(4, 0)
				),
				(err) => {
					assert.ok(err instanceof positron.StatementRangeSyntaxError);
					assert.strictEqual(err.line, 3);
					return true;
				}
			);
		});
	});
});

/**
 * Executes the statement range provider for an R file with the given contents
 * at the given position.
 */
async function getStatementRange(
	disposables: vscode.Disposable[],
	contents: string,
	position: vscode.Position
): Promise<positron.StatementRange | undefined> {
	const fileUri = await createRandomFile(contents, 'R');
	disposables.push({ dispose: () => deleteFile(fileUri) });

	const doc = await vscode.workspace.openTextDocument(fileUri);
	await vscode.window.showTextDocument(doc);

	return await vscode.commands.executeCommand<positron.StatementRange | undefined>(
		'vscode.executeStatementRangeProvider',
		doc.uri,
		position
	);
}
