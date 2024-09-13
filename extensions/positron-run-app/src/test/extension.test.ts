/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { PositronRunApp, RunAppOptions } from '../positron-run-app';
import { raceTimeout } from '../utils';

suite('PositronRunApp', () => {
	teardown(async () => {
		sinon.restore();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	async function getRunAppApI(): Promise<PositronRunApp> {
		const extension = vscode.extensions.getExtension<PositronRunApp>('vscode.positron-run-app');
		if (!extension) {
			throw new Error('Could not find Positron Run App extension');
		}
		return extension.activate();
	}

	test('runApplication', async () => {
		// Use a mocked runtime with a runtimePath of `cat` so that executing a file
		// will simply print its contents to the terminal.
		const runtime = {
			runtimePath: 'cat',
		} as positron.LanguageRuntimeMetadata;

		// Create and open a file in the workspace with the contents of a local URL.
		const url = 'http://localhost:8000';
		const content = Buffer.from(`Server started: ${url}`);
		assert(vscode.workspace.workspaceFolders, 'No workspace folders');
		const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
		const uri = vscode.Uri.joinPath(workspaceUri, 'test.py');
		await vscode.workspace.fs.writeFile(uri, content);
		await vscode.window.showTextDocument(uri);

		// Stub the runtime API to return the mocked runtime.
		sinon.stub(positron.runtime, 'getPreferredRuntime')
			.callsFake(async (_languageId) => {
				return runtime;
			});

		// Stub the preview URL function.
		const previewUrlStub = sinon.stub(positron.window, 'previewUrl');

		// Create a promise that resolves with the executed command line when an execution is
		// started for the application's terminal.
		const executedCommandLinePromise = new Promise<string>(resolve => {
			vscode.window.onDidStartTerminalShellExecution(e => {
				if (e.terminal.name === options.name) {
					resolve(e.execution.commandLine.value);
				}
			});
		});

		// Run the test application.
		const options: RunAppOptions = {
			name: 'Test App',
			async getTerminalOptions(runtime, document, _port, _urlPrefix) {
				return {
					commandLine: [runtime.runtimePath, document.uri.fsPath].join(' '),
				};
			},
		};
		const runAppApi = await getRunAppApI();
		await runAppApi.runApplication(options);

		// Check that a terminal was created for the application.
		const terminal = vscode.window.terminals.find((t) => t.name === options.name);
		assert(terminal, 'Terminal not found');

		// Check that the expected command line was executed in the terminal.
		// Use a timeout of 0 since it should have resolved by now.
		const executedCommandLine = await raceTimeout(executedCommandLinePromise, 0);
		assert.strictEqual(executedCommandLine, `${runtime.runtimePath} ${uri.fsPath}`);

		// Check that the expected URL was previewed.
		sinon.assert.calledWith(previewUrlStub, vscode.Uri.parse(url));
	});
});
