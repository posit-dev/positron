/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { openTestJupyterNotebookDocument, stubSetHasRunningNotebookSessionContext } from './utils';
import { TestLanguageRuntimeSession } from './testLanguageRuntimeSession';

suite('commands', () => {
	let disposables: vscode.Disposable[];
	let session: TestLanguageRuntimeSession;
	let onDidSetPositronHasRunningNotebookSessionContext: vscode.Event<boolean>;

	setup(() => {
		disposables = [];

		session = new TestLanguageRuntimeSession();

		onDidSetPositronHasRunningNotebookSessionContext = stubSetHasRunningNotebookSessionContext(disposables);
	});

	teardown(() => {
		vscode.Disposable.from(...disposables).dispose();
		sinon.restore();
	});

	test('restart disables then enables hasRunningNotebookSession context', async () => {
		// Simulate a running session for the notebook.
		sinon.stub(positron.runtime, 'getNotebookSession').resolves(session as any);

		sinon.stub(positron.runtime, 'restartSession').callsFake(async () => {
			session.setRuntimeState(positron.RuntimeState.Ready);
		});

		// Show a test Jupyter notebook.
		await openTestJupyterNotebookDocument();

		// Create a promise that resolves when the hasRunningNotebookSession context is set.
		// TODO: Assert first set to false then to true.
		const values: boolean[] = [];
		disposables.push(onDidSetPositronHasRunningNotebookSessionContext(value => {
			values.push(value);
		}));

		await vscode.commands.executeCommand('positron.restartKernel');

		// Assert that the context is eventually set to true.
		assert.deepStrictEqual(values, [false, true]);
	});
});
