/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { closeAllEditors, openTestJupyterNotebookDocument } from './utils';
import { TestLanguageRuntimeSession } from './testLanguageRuntimeSession';
import { onDidSetHasRunningNotebookSessionContext } from '../extension';

suite('commands', () => {
	let disposables: vscode.Disposable[];
	let session: TestLanguageRuntimeSession;

	setup(() => {
		disposables = [];
		session = new TestLanguageRuntimeSession();
	});

	teardown(async () => {
		await closeAllEditors();
		vscode.Disposable.from(...disposables).dispose();
		sinon.restore();
	});

	test('restart disables then enables hasRunningNotebookSession context', async () => {
		// Simulate a running session for the notebook.
		sinon.stub(positron.runtime, 'getNotebookSession').resolves(session as any);

		// Simulate a successful restart.
		sinon.stub(positron.runtime, 'restartSession').callsFake(async () => {
			session.setRuntimeState(positron.RuntimeState.Ready);
		});

		// Open a test Jupyter notebook.
		await openTestJupyterNotebookDocument();

		// Capture the first two hasRunningNotebookSession context values.
		const promise = new Promise<boolean[]>(resolve => {
			const values: boolean[] = [];
			disposables.push(onDidSetHasRunningNotebookSessionContext(value => {
				values.push(value);
				if (values.length === 2) {
					resolve(values);
				}
			}));
		});

		// Restart.
		await vscode.commands.executeCommand('positron.restartKernel');

		// Assert that the context is first set to false, then true.
		assert.deepStrictEqual(await promise, [false, true]);
	});
});
