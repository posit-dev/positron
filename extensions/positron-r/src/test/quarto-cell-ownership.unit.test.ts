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
import { quartoCellsKey, quartoCellsUriFor } from '../lsp';

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
		// Core builds the hidden notebook from the source URI, so on a remote window it
		// carries the remote authority, while the session derives its own from a metadata
		// URI that arrives here already transformed to a plain file: URI without one.
		const fromCore = vscode.Uri.parse('quarto-cells://ssh-remote%2Bhost/home/u/a.qmd.ipynb');
		const fromSession = vscode.Uri.parse('quarto-cells:/home/u/a.qmd.ipynb');

		assert.strictEqual(quartoCellsKey(fromCore), quartoCellsKey(fromSession));
	});
});

suite('Quarto cell ownership: quartoCellsUriFor', () => {
	/** An open text document, which is how an untitled document is classified. */
	function openDocument(uri: vscode.Uri, languageId: string): vscode.TextDocument {
		return { uri, languageId } as vscode.TextDocument;
	}

	test('a .qmd path produces the quarto-cells notebook for it', () => {
		const notebookUri = vscode.Uri.file('/home/u/doc.qmd');

		assert.strictEqual(quartoCellsUriFor(notebookUri)?.toString(), 'quarto-cells:/home/u/doc.qmd.ipynb');
	});

	test('a .Rmd path produces the quarto-cells notebook for it, case-insensitively', () => {
		const notebookUri = vscode.Uri.file('/home/u/doc.RMD');

		assert.strictEqual(quartoCellsUriFor(notebookUri)?.toString(), 'quarto-cells:/home/u/doc.RMD.ipynb');
	});

	test('a real .ipynb notebook is not a Quarto session', () => {
		const notebookUri = vscode.Uri.file('/home/u/notebook.ipynb');

		assert.strictEqual(quartoCellsUriFor(notebookUri, []), undefined);
	});

	test('an untitled Quarto document is classified by its language id', () => {
		// _Quarto: New Document_ opens the document with a language id and no
		// path, so the extension alone cannot tell it from any other untitled
		// file. Core names its hidden notebook `Untitled-1.qmd.ipynb`.
		const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1' });
		const documents = [openDocument(notebookUri, 'quarto')];

		assert.strictEqual(
			quartoCellsUriFor(notebookUri, documents)?.toString(),
			'quarto-cells:Untitled-1.qmd.ipynb');
	});

	test('an untitled document of another language is not a Quarto session', () => {
		const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1' });
		const documents = [openDocument(notebookUri, 'r')];

		assert.strictEqual(quartoCellsUriFor(notebookUri, documents), undefined);
	});

	test('an untitled document that is not open yet is still a Quarto session', () => {
		// A restored session can reach the extension before its document does,
		// and the document selector is built from this answer once. A real
		// notebook would have carried an extension or a notebook type, so what
		// is left is a Quarto document.
		const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1' });

		assert.strictEqual(
			quartoCellsUriFor(notebookUri, [])?.toString(),
			'quarto-cells:Untitled-1.qmd.ipynb');
	});

	test('an untitled notebook is not a Quarto session, by its path', () => {
		const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1.ipynb' });

		assert.strictEqual(quartoCellsUriFor(notebookUri, []), undefined);
	});

	test('an untitled notebook is not a Quarto session, by its notebook type', () => {
		// Core names an untitled notebook `Untitled-N<ending>` and puts its type
		// in the query. A notebook type with no file ending leaves only the query.
		const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1', query: 'some-notebook' });

		assert.strictEqual(quartoCellsUriFor(notebookUri, []), undefined);
	});
});
