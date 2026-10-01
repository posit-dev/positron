/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageClient, State } from 'vscode-languageclient/node';
import { RHelpTopicProvider } from '../help';
import { RStatementRangeProvider } from '../statement-range';
import { notebookCellFilter, quartoCellsKey } from '../lsp';

// A running client whose only job is to prove it was never asked.
const untouchedClient = {
	state: State.Running,
	sendRequest: () => {
		throw new Error('the client must not be asked about a declined document');
	},
} as unknown as LanguageClient;

// A client that has stopped, as a session's client does when its session is
// shut down. Its provider registrations outlive it, so it is still asked.
const stoppedClient = {
	state: State.Stopped,
	sendRequest: () => {
		throw new Error('a stopped client must not be asked at all');
	},
} as unknown as LanguageClient;

suite('Quarto cell ownership: provider declines', () => {
	let document: vscode.TextDocument;

	suiteSetup(async () => {
		document = await vscode.workspace.openTextDocument({ language: 'r', content: 'x <- 1' });
	});

	test('the statement range provider returns undefined for a declined document', async () => {
		const provider = new RStatementRangeProvider(untouchedClient, () => true);

		const result = await provider.provideStatementRange(
			document, new vscode.Position(0, 0), new vscode.CancellationTokenSource().token);

		assert.strictEqual(result, undefined);
	});

	test('the help topic provider returns undefined for a declined document', async () => {
		const provider = new RHelpTopicProvider(untouchedClient, () => true);

		const result = await provider.provideHelpTopic(
			document, new vscode.Position(0, 0), new vscode.CancellationTokenSource().token);

		assert.strictEqual(result, undefined);
	});

	test('the statement range provider returns undefined when its client has stopped', async () => {
		// Nothing accepts this document, so only the client's own state can
		// keep the request from reaching a dead connection.
		const provider = new RStatementRangeProvider(stoppedClient, () => false);

		const result = await provider.provideStatementRange(
			document, new vscode.Position(0, 0), new vscode.CancellationTokenSource().token);

		assert.strictEqual(result, undefined);
	});

	test('the help topic provider returns undefined when its client has stopped', async () => {
		const provider = new RHelpTopicProvider(stoppedClient, () => false);

		const result = await provider.provideHelpTopic(
			document, new vscode.Position(0, 0), new vscode.CancellationTokenSource().token);

		assert.strictEqual(result, undefined);
	});

	test('the ownership key ignores a remote authority', async () => {
		const fromCore = vscode.Uri.parse('quarto-cells://ssh-remote%2Bhost/home/u/a.qmd.ipynb');
		const fromSession = vscode.Uri.parse('quarto-cells:/home/u/a.qmd.ipynb');

		assert.strictEqual(quartoCellsKey(fromCore), quartoCellsKey(fromSession));
	});
});

function fakeNotebook(uri: string, notebookType: string): vscode.NotebookDocument {
	return { uri: vscode.Uri.parse(uri), notebookType } as unknown as vscode.NotebookDocument;
}

const someCells = [{}, {}] as unknown as vscode.NotebookCell[];

suite('Quarto cell ownership: notebookCellFilter', () => {
	test('a Quarto session client keeps only its own notebook', () => {
		const filter = notebookCellFilter(vscode.Uri.parse('quarto-cells:/proj/doc.qmd.ipynb'));

		assert.deepStrictEqual(filter(fakeNotebook('quarto-cells:/proj/doc.qmd.ipynb', 'quarto-cells'), someCells), someCells);
		assert.deepStrictEqual(filter(fakeNotebook('quarto-cells:/proj/other.qmd.ipynb', 'quarto-cells'), someCells), []);
	});

	test('a Quarto session client ignores the remote authority', () => {
		const filter = notebookCellFilter(vscode.Uri.parse('quarto-cells:/proj/doc.qmd.ipynb'));

		assert.deepStrictEqual(filter(fakeNotebook('quarto-cells://ssh-remote%2Bhost/proj/doc.qmd.ipynb', 'quarto-cells'), someCells), someCells);
	});

	test('a notebook session client keeps only its own notebook', () => {
		const filter = notebookCellFilter(vscode.Uri.parse('file:///proj/analysis.ipynb'));

		assert.deepStrictEqual(filter(fakeNotebook('file:///proj/analysis.ipynb', 'jupyter-notebook'), someCells), someCells);
		assert.deepStrictEqual(filter(fakeNotebook('quarto-cells:/proj/doc.qmd.ipynb', 'quarto-cells'), someCells), []);
	});

	test('the console client keeps Quarto notebooks and drops real notebooks', () => {
		const filter = notebookCellFilter(undefined);

		assert.deepStrictEqual(filter(fakeNotebook('quarto-cells:/proj/doc.qmd.ipynb', 'quarto-cells'), someCells), someCells);
		assert.deepStrictEqual(filter(fakeNotebook('file:///proj/analysis.ipynb', 'jupyter-notebook'), someCells), []);
	});
});
