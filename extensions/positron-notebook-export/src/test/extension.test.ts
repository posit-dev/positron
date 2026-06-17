/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { NotebookExporter } from '../positron-notebook-export.js';
import { activateExtension, openAndShowWorkspaceNotebook } from './util.js';
import { NotebookExportCommand } from '../notebookExportCommand.js';

function makeTestExporter() {
	return {
		label: 'Test',
		fileExtension: '.test',
		supportedLanguageId: 'test',
		export: sinon.stub(),
	} satisfies NotebookExporter;
}

function makeTestPythonExporter() {
	return {
		label: 'Python',
		fileExtension: '.py',
		supportedLanguageId: 'python',
		export: sinon.stub(),
	} satisfies NotebookExporter;
}

suite('Positron Notebook Export', () => {
	let disposables: vscode.Disposable[] = [];

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		disposables.forEach(d => d.dispose());
		disposables = [];
		sinon.restore();
	});

	test('shows empty quick pick when no exporters are registered', async () => {
		const notebook = await openAndShowWorkspaceNotebook('test-notebook.ipynb');
		const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

		await vscode.commands.executeCommand(NotebookExportCommand.ID, notebook.uri);

		sinon.assert.calledOnceWithExactly(showQuickPickStub, []);
	});

	test('shows only exporters that support the notebook language', async () => {
		// The test notebook has the language "test".
		// If we register an exporter with another language, it should not
		// show in the export quick pick.
		const notebook = await openAndShowWorkspaceNotebook('test-notebook.ipynb');
		const api = await activateExtension();
		const exporter = makeTestExporter();
		disposables.push(api.registerNotebookExporter(exporter));
		disposables.push(api.registerNotebookExporter(makeTestPythonExporter()));
		const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

		await vscode.commands.executeCommand(NotebookExportCommand.ID, notebook.uri);

		sinon.assert.calledOnceWithExactly(showQuickPickStub, [
			sinon.match((item: vscode.QuickPickItem) => item.label === exporter.label),
		]);
	});

	test('exports a notebook with a registered exporter', async () => {
		const notebook = await openAndShowWorkspaceNotebook('test-notebook.ipynb');
		const api = await activateExtension();
		const exporter = makeTestExporter();
		disposables.push(api.registerNotebookExporter(exporter));
		const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').callsFake(async (items) => {
			// Return the test exporter item, as if it were selected by the user.
			const item = (await items).find(item => item.label === exporter.label);
			return item;
		});

		await vscode.commands.executeCommand(NotebookExportCommand.ID, notebook.uri);

		// eslint-disable-next-line local/code-no-any-casts
		sinon.assert.calledOnceWithExactly(showQuickPickStub, [{
			label: exporter.label,
			description: `(${exporter.fileExtension})`,
			iconPath: vscode.ThemeIcon.File,
			resourceUri: sinon.match((uri: vscode.Uri) => uri.fsPath.endsWith(exporter.fileExtension)),
			export: sinon.match.func,
		} as any]);
		sinon.assert.calledOnceWithExactly(exporter.export, notebook);
	});

	test('removes an exporter from the quick pick when it is disposed', async () => {
		const notebook = await openAndShowWorkspaceNotebook('test-notebook.ipynb');
		const api = await activateExtension();
		const exporter = makeTestExporter();
		const registration = api.registerNotebookExporter(exporter);
		const showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

		await vscode.commands.executeCommand(NotebookExportCommand.ID, notebook.uri);

		// Double-check that it shows before we dispose it.
		sinon.assert.calledOnceWithExactly(showQuickPickStub, [
			sinon.match((item: vscode.QuickPickItem) => item.label === exporter.label)
		]);

		// Dispose, and verify that it no longer shows in the quick pick.
		showQuickPickStub.resetHistory();
		registration.dispose();

		await vscode.commands.executeCommand(NotebookExportCommand.ID, notebook.uri);

		sinon.assert.calledOnceWithExactly(showQuickPickStub, []);
	});
});
