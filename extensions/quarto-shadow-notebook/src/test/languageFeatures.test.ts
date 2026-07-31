/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extension host tests for the Quarto shadow bridge providers
 * (src/vs/workbench/contrib/positronQuarto/browser/quartoShadowLanguageFeatures.contribution.ts).
 *
 * End-to-end over the REAL pipeline: a real vscode-languageclient syncs the
 * hidden shadow notebook to a real in-process vscode-languageserver that
 * declares completion and hover capabilities. Invoking the standard
 * `vscode.execute*Provider` commands on the .qmd TEXT document at a position
 * inside a code cell must reach the server (at cell coordinates, with the
 * cell's vscode-notebook-cell URI) and surface its results mapped back to
 * .qmd coordinates.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	MessageTransports,
	StreamMessageReader,
	StreamMessageWriter,
} from 'vscode-languageclient/node';
import { createConnection } from 'vscode-languageserver/node';

/** The notebook type registered core-side for shadow notebooks. */
const SHADOW_NOTEBOOK_TYPE = 'quarto-shadow';

/** Requests the language-feature test server has received. */
interface FeatureServerRecord {
	/** notebookDocument/didOpen notebook URIs, in arrival order. */
	notebookOpens: string[];
	/** textDocument/completion params, in arrival order. */
	completionRequests: any[];
	/** textDocument/hover params, in arrival order. */
	hoverRequests: any[];
}

/** Poll until `condition` is true or fail with `message` after 15s. */
async function waitFor(condition: () => boolean, message: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (!condition()) {
		if (Date.now() > deadline) {
			assert.fail(`Timed out waiting for: ${message}`);
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
}

/**
 * Start the in-process LSP server: notebook sync for python shadow cells,
 * plus completion and hover. Responses are in CELL coordinates (line 0 is the
 * cell's first code line), exactly like a real notebook-aware server.
 */
function startFeatureServer(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): FeatureServerRecord {
	const record: FeatureServerRecord = { notebookOpens: [], completionRequests: [], hoverRequests: [] };
	const connection = createConnection(input, output);
	connection.onInitialize(() => ({
		capabilities: {
			notebookDocumentSync: {
				notebookSelector: [{
					notebook: { notebookType: SHADOW_NOTEBOOK_TYPE },
					cells: [{ language: 'python' }],
				}],
			},
			completionProvider: { triggerCharacters: ['.'] },
			hoverProvider: true,
		},
	}));
	connection.onNotification('notebookDocument/didOpen', params => {
		record.notebookOpens.push(params.notebookDocument.uri);
	});
	connection.onRequest('textDocument/completion', params => {
		record.completionRequests.push(params);
		return [{
			label: 'shadow_completion',
			kind: 6, // Variable
			textEdit: {
				range: {
					start: { line: params.position.line, character: 0 },
					end: { line: params.position.line, character: params.position.character },
				},
				newText: 'shadow_completion',
			},
		}];
	});
	connection.onRequest('textDocument/hover', params => {
		record.hoverRequests.push(params);
		return {
			contents: { kind: 'markdown', value: 'shadow hover docs' },
			range: {
				start: { line: params.position.line, character: 0 },
				end: { line: params.position.line, character: 5 },
			},
		};
	});
	connection.listen();
	return record;
}

/** Write a qmd file with one python cell and return its URI and layout. */
function writeQmd(dir: string, name: string, cellSource: string): { uri: vscode.Uri; cellCodeLine: number } {
	const parts = ['---', 'title: bridge test', '---', '', 'Some prose.', '', '```{python}', cellSource, '```', '', 'More prose.', ''];
	const file = path.join(dir, name);
	fs.writeFileSync(file, parts.join('\n'));
	// 0-based line of the cell's code line in the document.
	return { uri: vscode.Uri.file(file), cellCodeLine: parts.indexOf(cellSource) };
}

/** Find the shadow notebook mirroring `uri`, if the ext host has seen it. */
function findShadowNotebook(uri: vscode.Uri): vscode.NotebookDocument | undefined {
	return vscode.workspace.notebookDocuments.find(notebook =>
		notebook.uri.toString() === uri.toString() && notebook.notebookType === SHADOW_NOTEBOOK_TYPE);
}

suite('Quarto shadow bridge language features (end-to-end)', () => {
	let record: FeatureServerRecord;
	let tmpDir: string;
	let qmdUri: vscode.Uri;
	let cellCodeLine: number;
	let cellUri: string;

	suiteSetup(async function () {
		this.timeout(60_000);
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-shadow-bridge-'));

		// In-process server + client, mirroring shadowNotebook.test.ts.
		const clientToServer = new PassThrough();
		const serverToClient = new PassThrough();
		record = startFeatureServer(clientToServer, serverToClient);
		const serverOptions = async (): Promise<MessageTransports> => ({
			reader: new StreamMessageReader(serverToClient),
			writer: new StreamMessageWriter(clientToServer),
		});
		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ language: 'python' }],
		};
		const client = new LanguageClient('quartoShadowBridge', 'Quarto Shadow Bridge', serverOptions, clientOptions);
		await client.start();

		// Open the .qmd and wait for its shadow notebook to sync to the server.
		({ uri: qmdUri, cellCodeLine } = writeQmd(tmpDir, 'bridge.qmd', 'x = 1'));
		const textDoc = await vscode.workspace.openTextDocument(qmdUri);
		// The bridge providers are registered for the quarto language id
		// (contributed by this test extension for .qmd files).
		assert.strictEqual(textDoc.languageId, 'quarto');
		await waitFor(() => !!findShadowNotebook(qmdUri), 'shadow notebook appears');
		cellUri = findShadowNotebook(qmdUri)!.cellAt(0).document.uri.toString();
		await waitFor(
			() => record.notebookOpens.includes(qmdUri.toString()),
			'server receives notebookDocument/didOpen for the shadow notebook',
		);
	});

	suiteTeardown(async function () {
		this.timeout(30_000);
		// Deliberately do NOT client.stop(): the server runs in-process, and
		// vscode-languageserver's exit-notification handler calls
		// process.exit(), killing the extension host mid-run.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('completions inside a cell reach the server at cell coordinates and come back at .qmd coordinates', async () => {
		// Request at the end of 'x' on the cell's code line ('x = 1').
		const list = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider', qmdUri, new vscode.Position(cellCodeLine, 1));

		// The server was asked with the CELL document and CELL position:
		// line 0 of the cell, not the .qmd line.
		await waitFor(() => record.completionRequests.length > 0, 'server receives textDocument/completion');
		const request = record.completionRequests[0];
		assert.strictEqual(request.textDocument.uri, cellUri);
		assert.deepStrictEqual(request.position, { line: 0, character: 1 });

		// The server's item surfaced with its range mapped to the .qmd line.
		const item = list.items.find(candidate =>
			typeof candidate.label === 'string' ? candidate.label === 'shadow_completion' : candidate.label.label === 'shadow_completion');
		assert.ok(item, `server completion appears in the .qmd results (got: ${list.items.map(i => JSON.stringify(i.label)).join(', ')})`);
		const range = item.range instanceof vscode.Range ? item.range : item.range?.replacing;
		assert.ok(range, 'completion item carries a range');
		assert.strictEqual(range.start.line, cellCodeLine, 'range start maps to the .qmd code line');
		assert.strictEqual(range.end.line, cellCodeLine, 'range end maps to the .qmd code line');
	});

	test('completions in prose do not hit the server', async () => {
		const requestsBefore = record.completionRequests.length;
		// Line 4 (0-based) is 'Some prose.'.
		await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider', qmdUri, new vscode.Position(4, 3));
		assert.strictEqual(record.completionRequests.length, requestsBefore, 'no completion request was forwarded for prose');
	});

	test('hover inside a cell reaches the server and comes back at .qmd coordinates', async () => {
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider', qmdUri, new vscode.Position(cellCodeLine, 1));

		await waitFor(() => record.hoverRequests.length > 0, 'server receives textDocument/hover');
		const request = record.hoverRequests[0];
		assert.strictEqual(request.textDocument.uri, cellUri);
		assert.deepStrictEqual(request.position, { line: 0, character: 1 });

		const hover = hovers.find(candidate => candidate.contents.some(content =>
			(content instanceof vscode.MarkdownString ? content.value : String(content)).includes('shadow hover docs')));
		assert.ok(hover, 'the server hover surfaced in the .qmd editor');
		assert.strictEqual(hover.range?.start.line, cellCodeLine, 'hover range maps to the .qmd code line');
	});

	test('hover on a fence line does not hit the server', async () => {
		const requestsBefore = record.hoverRequests.length;
		// The opening fence is the line above the cell code.
		await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider', qmdUri, new vscode.Position(cellCodeLine - 1, 3));
		assert.strictEqual(record.hoverRequests.length, requestsBefore, 'no hover request was forwarded for the fence line');
	});
});
