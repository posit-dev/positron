/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extension host tests for Positron's core-owned Quarto shadow notebook
 * (src/vs/workbench/contrib/positronQuarto/browser/quartoShadowNotebookService.ts).
 *
 * These tests exercise the REAL pipeline: opening a .qmd text document makes
 * core create a hidden notebook document that is mirrored to this extension
 * host, where a real vscode-languageclient LanguageClient syncs it to a real
 * in-process vscode-languageserver connection. Every notification the server
 * receives is recorded and asserted on. No notebook is ever created test-side.
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

/** The setting that gates the shadow notebook system. */
const SHADOW_NOTEBOOK_SETTING = 'quarto.shadowNotebook.enabled';

/** Everything the test server has received from the client. */
interface ServerRecord {
	/** notebookDocument/didOpen params, in arrival order. */
	notebookOpens: any[];
	/** notebookDocument/didChange params, in arrival order. */
	notebookChanges: any[];
	/** notebookDocument/didClose notebook URIs, in arrival order. */
	notebookCloses: string[];
}

/**
 * The push diagnostic message the server publishes for every cell it sees,
 * tagged per server so assertions can tell client versions apart.
 */
function pushMessage(tag: string): string {
	return `shadow push diagnostic [${tag}]`;
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

/** Start the in-process LSP server on the given streams. */
function startServer(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, tag: string): ServerRecord {
	const record: ServerRecord = { notebookOpens: [], notebookChanges: [], notebookCloses: [] };
	const connection = createConnection(input, output);
	connection.onInitialize(() => ({
		capabilities: {
			notebookDocumentSync: {
				notebookSelector: [{
					notebook: { notebookType: SHADOW_NOTEBOOK_TYPE },
					cells: [{ language: 'python' }],
				}],
			},
		},
	}));
	connection.onNotification('notebookDocument/didOpen', params => {
		record.notebookOpens.push(params);
		// Push a diagnostic for every cell, the way ruff and pyrefly do for
		// notebooks. Push diagnostics are never filtered client-side, so they
		// land in vscode's diagnostics collection even for a notebook that
		// has no editor anywhere.
		for (const cellDoc of params.cellTextDocuments) {
			void connection.sendDiagnostics({
				uri: cellDoc.uri,
				diagnostics: [{
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					message: pushMessage(tag),
					severity: 2,
				}],
			});
		}
	});
	connection.onNotification('notebookDocument/didChange', params => record.notebookChanges.push(params));
	connection.onNotification('notebookDocument/didClose', params => record.notebookCloses.push(params.notebookDocument.uri));
	connection.listen();
	return record;
}

/** Start a languageclient (10.x) connected to an in-process server. */
async function startClient(): Promise<{ client: LanguageClient; record: ServerRecord }> {
	const clientToServer = new PassThrough();
	const serverToClient = new PassThrough();
	const record = startServer(clientToServer, serverToClient, 'v10');
	const serverOptions = async (): Promise<MessageTransports> => ({
		reader: new StreamMessageReader(serverToClient),
		writer: new StreamMessageWriter(clientToServer),
	});
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ language: 'python' }],
	};
	const client = new LanguageClient('quartoShadowCore', 'Quarto Shadow Core', serverOptions, clientOptions);
	await client.start();
	return { client, record };
}

/** Write a qmd file with the given python cells and return its URI. */
function writeQmd(dir: string, name: string, cellSources: string[]): vscode.Uri {
	const parts = ['---', 'title: shadow test', '---', '', 'Some prose.', ''];
	for (const source of cellSources) {
		parts.push('```{python}', source, '```', '', 'More prose.', '');
	}
	const file = path.join(dir, name);
	fs.writeFileSync(file, parts.join('\n'));
	return vscode.Uri.file(file);
}

/** Find the shadow notebook mirroring `uri`, if the ext host has seen it. */
function findShadowNotebook(uri: vscode.Uri): vscode.NotebookDocument | undefined {
	return vscode.workspace.notebookDocuments.find(notebook =>
		notebook.uri.toString() === uri.toString() && notebook.notebookType === SHADOW_NOTEBOOK_TYPE);
}

/** Open the qmd text document and wait for its shadow notebook to appear. */
async function openQmdAndWaitForShadow(uri: vscode.Uri): Promise<{ textDoc: vscode.TextDocument; notebook: vscode.NotebookDocument }> {
	const textDoc = await vscode.workspace.openTextDocument(uri);
	await waitFor(() => !!findShadowNotebook(uri), `shadow notebook appears for ${uri.toString()}`);
	return { textDoc, notebook: findShadowNotebook(uri)! };
}

suite('Quarto shadow notebook (core-owned)', () => {
	let record: ServerRecord;
	let tmpDir: string;

	suiteSetup(async function () {
		this.timeout(60_000);
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-shadow-core-'));
		({ record } = await startClient());
	});

	suiteTeardown(async function () {
		this.timeout(30_000);
		// Deliberately do NOT client.stop(): the server runs in-process, and
		// vscode-languageserver's exit-notification handler calls
		// process.exit(), killing the extension host mid-run.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('tracer bullet: opening a .qmd text document creates a hidden mirrored notebook', async () => {
		const uri = writeQmd(tmpDir, 'one.qmd', ['x = 1', 'y = x + 1']);

		// Opening the TEXT document alone (no editor anywhere) is enough:
		// core watches text models, not editors.
		const { notebook } = await openQmdAndWaitForShadow(uri);

		// Same URI as the qmd file; code cells with standard cell URIs and
		// the fence language mapped to a language ID.
		assert.strictEqual(notebook.uri.toString(), uri.toString());
		assert.strictEqual(notebook.notebookType, SHADOW_NOTEBOOK_TYPE);
		assert.strictEqual(notebook.cellCount, 2);
		assert.deepStrictEqual(notebook.getCells().map(cell => cell.document.getText()), ['x = 1', 'y = x + 1']);
		for (const cell of notebook.getCells()) {
			assert.strictEqual(cell.kind, vscode.NotebookCellKind.Code);
			assert.strictEqual(cell.document.uri.scheme, 'vscode-notebook-cell');
			assert.strictEqual(cell.document.languageId, 'python');
		}

		// The notebook is genuinely hidden: no notebook editor, no notebook tab.
		assert.strictEqual(vscode.window.visibleNotebookEditors.length, 0);
		const notebookTabs = vscode.window.tabGroups.all
			.flatMap(group => group.tabs)
			.filter(tab => tab.input instanceof vscode.TabInputNotebook);
		assert.strictEqual(notebookTabs.length, 0);

		// Never dirty: core creates the model without any working copy.
		assert.strictEqual(notebook.isDirty, false);
	});

	test('(a) server receives notebookDocument/didOpen with correct cells', async () => {
		const uri = vscode.Uri.file(path.join(tmpDir, 'one.qmd'));
		await waitFor(
			() => record.notebookOpens.some(open => open.notebookDocument.uri === uri.toString()),
			'server receives notebookDocument/didOpen for the hidden notebook',
		);
		const open = record.notebookOpens.find(o => o.notebookDocument.uri === uri.toString());
		assert.deepStrictEqual(open.cellTextDocuments.map((doc: any) => doc.text), ['x = 1', 'y = x + 1']);
		for (const cellDoc of open.cellTextDocuments) {
			assert.ok(
				cellDoc.uri.startsWith('vscode-notebook-cell:'),
				`cell URI uses the standard scheme: ${cellDoc.uri}`,
			);
			assert.strictEqual(cellDoc.languageId, 'python');
		}
	});

	test('(b) editing the .qmd produces notebookDocument/didChange and never dirties the notebook', async () => {
		const uri = vscode.Uri.file(path.join(tmpDir, 'one.qmd'));
		const notebook = findShadowNotebook(uri)!;
		const cellUri = notebook.cellAt(0).document.uri.toString();
		const textDoc = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(textDoc);

		// Replace 'x = 1' with 'x = 42' in the qmd TEXT buffer.
		const text = textDoc.getText();
		const offset = text.indexOf('x = 1');
		const applied = await editor.edit(builder => builder.replace(
			new vscode.Range(textDoc.positionAt(offset), textDoc.positionAt(offset + 'x = 1'.length)),
			'x = 42',
		));
		assert.ok(applied, 'text edit should apply');

		// The sync applies a MINIMAL in-place edit, so the server receives an
		// incremental textContent change for the cell (inserting '42'), not a
		// whole-cell replacement.
		const cellTextChanges = () => record.notebookChanges
			.flatMap((change: any) => change.change?.cells?.textContent ?? [])
			.filter((textContent: any) => textContent.document.uri === cellUri);
		await waitFor(
			() => cellTextChanges().some((textContent: any) =>
				(textContent.changes ?? []).some((c: any) => typeof c.text === 'string' && c.text.includes('42'))),
			'server receives notebookDocument/didChange with an incremental text change for the cell',
		);

		// The mirrored edit reached the ext host cell document too.
		assert.strictEqual(notebook.cellAt(0).document.getText(), 'x = 42');

		// Mirrored edits never dirty the shadow notebook (no working copy:
		// no backup writes, no Save All participation, no restore-on-reload).
		assert.strictEqual(notebook.isDirty, false);
	});

	test('adding a cell splices incrementally without closing existing cells', async () => {
		const uri = vscode.Uri.file(path.join(tmpDir, 'one.qmd'));
		const notebook = findShadowNotebook(uri)!;
		const existingCellUris = notebook.getCells().map(cell => cell.document.uri.toString());

		const textDoc = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(textDoc);
		const changesBefore = record.notebookChanges.length;

		// Append a third cell to the qmd.
		const endPosition = textDoc.positionAt(textDoc.getText().length);
		const applied = await editor.edit(builder => builder.insert(endPosition, '\n```{python}\nz = 3\n```\n'));
		assert.ok(applied);

		await waitFor(() => notebook.cellCount === 3, 'the shadow notebook gains a third cell');
		await waitFor(
			() => record.notebookChanges.slice(changesBefore).some(change => JSON.stringify(change).includes('z = 3')),
			'server receives a didChange containing the new cell',
		);

		// Splice sync: the pre-existing cells were not closed and reopened,
		// so server-side state for them (e.g. diagnostics) is preserved.
		const closedCellUris = record.notebookChanges.slice(changesBefore)
			.flatMap((change: any) => change.change?.cells?.structure?.didClose ?? [])
			.map((doc: any) => doc.uri);
		for (const cellUri of existingCellUris) {
			assert.ok(!closedCellUris.includes(cellUri), `existing cell was not closed by the splice: ${cellUri}`);
		}
		assert.deepStrictEqual(
			notebook.getCells().map(cell => cell.document.uri.toString()).slice(0, 2),
			existingCellUris,
			'existing cell URIs are unchanged',
		);
	});

	test('(c) server-pushed per-cell diagnostics land in vscode.languages.getDiagnostics for a fully hidden notebook', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		const uri = writeQmd(tmpDir, 'two.qmd', ['w = 5']);

		// Open the text document WITHOUT ever showing an editor.
		const { notebook } = await openQmdAndWaitForShadow(uri);
		await waitFor(
			() => record.notebookOpens.some(open => open.notebookDocument.uri === uri.toString()),
			'server receives notebookDocument/didOpen for the fully hidden notebook',
		);

		const cellUri = notebook.cellAt(0).document.uri;
		await waitFor(
			() => vscode.languages.getDiagnostics(cellUri).some(d => d.message === pushMessage('v10')),
			'pushed diagnostics for a hidden notebook cell reach the diagnostics collection',
		);
	});

	test('(d) disabling the setting closes the shadow notebook (didClose); re-enabling restores it', async function () {
		this.timeout(30_000);
		const uri = vscode.Uri.file(path.join(tmpDir, 'two.qmd'));
		assert.ok(findShadowNotebook(uri), 'shadow notebook exists before the toggle');

		const configuration = vscode.workspace.getConfiguration();
		try {
			await configuration.update(SHADOW_NOTEBOOK_SETTING, false, vscode.ConfigurationTarget.Global);
			await waitFor(
				() => record.notebookCloses.includes(uri.toString()),
				'server receives notebookDocument/didClose when the setting is disabled',
			);
			await waitFor(() => !findShadowNotebook(uri), 'the shadow notebook is closed in the ext host');

			const opensBefore = record.notebookOpens.length;
			await configuration.update(SHADOW_NOTEBOOK_SETTING, true, vscode.ConfigurationTarget.Global);
			await waitFor(
				() => record.notebookOpens.slice(opensBefore).some(open => open.notebookDocument.uri === uri.toString()),
				'server receives a fresh didOpen when the setting is re-enabled',
			);
			await waitFor(() => !!findShadowNotebook(uri), 'the shadow notebook is re-created in the ext host');
		} finally {
			await configuration.update(SHADOW_NOTEBOOK_SETTING, undefined, vscode.ConfigurationTarget.Global);
		}
	});
});

// The third-party reality check: ruff-vscode, air, and pyrefly's extension all
// bundle vscode-languageclient 9.0.1 (only positron-python is on 10.0.0).
// 9.0.1 has the same visibility-free notebook sync; servers behind it must
// push cell diagnostics (9.0.1 never pulls cells - see the spike findings in
// quarto-lsp-spike/fake-notebook.md in the main checkout).
suite('Quarto shadow notebook (core-owned, languageclient 9.0.1)', () => {
	// Same major API surface; the 10.x types are close enough for the test.
	const lc9 = require('vscode-languageclient-9/node') as typeof import('vscode-languageclient/node');

	let record: ServerRecord;
	let tmpDir: string;

	suiteSetup(async function () {
		this.timeout(60_000);
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-shadow-core9-'));

		const clientToServer = new PassThrough();
		const serverToClient = new PassThrough();
		record = startServer(clientToServer, serverToClient, 'v9');
		const client = new lc9.LanguageClient('quartoShadowCore9', 'Quarto Shadow Core 9', async (): Promise<MessageTransports> => ({
			reader: new StreamMessageReader(serverToClient),
			writer: new StreamMessageWriter(clientToServer),
		}), {
			documentSelector: [{ language: 'python' }],
		});
		await client.start();
	});

	suiteTeardown(async function () {
		this.timeout(30_000);
		// See suite 1's teardown for why the client is not stopped.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('9.0.1: hidden shadow notebook syncs and receives push diagnostics', async () => {
		const uri = writeQmd(tmpDir, 'three.qmd', ['v = 9']);
		const { notebook } = await openQmdAndWaitForShadow(uri);

		await waitFor(
			() => record.notebookOpens.some(open => open.notebookDocument.uri === uri.toString()),
			'9.0.1 client syncs the hidden notebook',
		);
		const cellUri = notebook.cellAt(0).document.uri;
		await waitFor(
			() => vscode.languages.getDiagnostics(cellUri).some(d => d.message === pushMessage('v9')),
			'push diagnostics from a 9.0.1 client reach the diagnostics collection',
		);
	});
});
