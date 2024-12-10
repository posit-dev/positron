/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { closeAllEditors, eventToPromise, openTestJupyterNotebookDocument } from './utils';
import { onDidSetHasRunningNotebookSessionContext } from '../extension';

suite('extension', () => {
	teardown(async () => {
		sinon.restore();
		await closeAllEditors();
	});

	test('showing a notebook with a running session enables hasRunningNotebookSession', async () => {
		// Simulate a running session for the notebook.
		sinon.stub(positron.runtime, 'getNotebookSession').resolves({} as positron.LanguageRuntimeSession);

		// Create a promise that resolves when the hasRunningNotebookSession context is set.
		const promise = eventToPromise(onDidSetHasRunningNotebookSessionContext);

		// Open a test Jupyter notebook.
		await openTestJupyterNotebookDocument();

		// Assert that the context is eventually set to true.
		assert.strictEqual(await promise, true);
	});

	test('showing a notebook without a running session disables hasRunningNotebookSession', async () => {
		// Simulate no running session for the notebook.
		sinon.stub(positron.runtime, 'getNotebookSession').resolves(undefined);

		// Create a promise that resolves when the hasRunningNotebookSession context is set.
		const promise = eventToPromise(onDidSetHasRunningNotebookSessionContext);

		// Open a test Jupyter notebook.
		await openTestJupyterNotebookDocument();

		// Assert that the context is eventually set to false.
		assert.strictEqual(await promise, false);
	});

	test('showing a text file disables hasRunningNotebookSession', async () => {
		// Simulate a running session for the notebook.
		sinon.stub(positron.runtime, 'getNotebookSession').resolves({} as positron.LanguageRuntimeSession);

		// Open a test Jupyter notebook.
		await openTestJupyterNotebookDocument();

		// Create a promise that resolves when the hasRunningNotebookSession context is set.
		const promise = eventToPromise(onDidSetHasRunningNotebookSessionContext);

		// Show a text file.
		const document = await vscode.workspace.openTextDocument({ content: 'Hello, world!' });
		await vscode.window.showTextDocument(document);

		// Assert that the context is eventually set to false.
		assert.strictEqual(await promise, false);
	});

	test('closing the active notebook disables hasRunningNotebookSession', async () => {
		// Simulate a running session for the notebook.
		sinon.stub(positron.runtime, 'getNotebookSession').resolves({} as positron.LanguageRuntimeSession);

		// Open a test Jupyter notebook.
		await openTestJupyterNotebookDocument();

		// Create a promise that resolves when the hasRunningNotebookSession context is set.
		const promise = eventToPromise(onDidSetHasRunningNotebookSessionContext);

		// Close the notebook.
		await closeAllEditors();

		// Assert that the context is eventually set to false.
		assert.strictEqual(await promise, false);
	});
});
