/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { RunAppOptions } from '../positron-run-app';
import { raceTimeout } from '../utils';
import { PositronRunAppApiImpl } from '../extension';

suite('PositronRunApp', () => {
	// Use a test runtime with a runtimePath of `cat` so that executing a file
	// will simply print its contents to the terminal.
	const runtime = {
		runtimePath: 'cat',
	} as positron.LanguageRuntimeMetadata;

	// The app server URL.
	const url = 'http://localhost:8000';

	// Options for running the test application.
	const options: RunAppOptions = {
		name: 'Test App',
		async getTerminalOptions(runtime, document, _port, _urlPrefix) {
			return {
				commandLine: [runtime.runtimePath, document.uri.fsPath].join(' '),
			};
		},
	};

	const disposables = new Array<vscode.Disposable>();

	let tempDir: string;
	let uri: vscode.Uri;
	let previewUrlStub: sinon.SinonStub;
	let sendTextSpy: sinon.SinonSpy | undefined;
	let shellIntegrationConfig: vscode.WorkspaceConfiguration;
	let executedCommandLine: string | undefined;
	let runAppApi: PositronRunAppApiImpl;

	setup(async () => {
		// Make a temporary folder.
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'positron-'));

		// Create and open a temporary file with the contents of the app server URL.
		const content = Buffer.from(`Server started: ${url}`);
		uri = vscode.Uri.parse(path.join(tempDir, 'test.txt'));
		await vscode.workspace.fs.writeFile(uri, content);
		await vscode.window.showTextDocument(uri);

		// Stub the runtime API to return the test runtime.
		sinon.stub(positron.runtime, 'getPreferredRuntime').callsFake(async (_languageId) => runtime);

		// Stub the preview URL function.
		previewUrlStub = sinon.stub(positron.window, 'previewUrl');

		// Stub `vscode.window.createTerminal` to spy on the created terminal's `sendText` method.
		const originalCreateTerminal = vscode.window.createTerminal;
		sendTextSpy = undefined;
		sinon.stub(vscode.window, 'createTerminal')
			.callsFake(options => {
				const terminal = originalCreateTerminal(options);
				sendTextSpy = sinon.spy(terminal, 'sendText');
				return terminal;
			});

		// Enable shell integration.
		shellIntegrationConfig = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration');
		await shellIntegrationConfig.update('enabled', true, vscode.ConfigurationTarget.Global);

		// Capture executions in the app's terminal while shell integration enabled.
		executedCommandLine = undefined;
		disposables.push(vscode.window.onDidStartTerminalShellExecution(e => {
			if (e.terminal.name === options.name) {
				assert(!executedCommandLine, 'Multiple terminal shell executions started');
				executedCommandLine = e.execution.commandLine.value;
			}
		}));

		runAppApi = await getRunAppApi();

		runAppApi.setShellIntegrationSupported(true);
	});

	teardown(async () => {
		sinon.restore();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await fs.rm(tempDir, { recursive: true, force: true });
		disposables.forEach(d => d.dispose());
		disposables.splice(0, disposables.length);
	});

	async function getRunAppApi(): Promise<PositronRunAppApiImpl> {
		const extension = vscode.extensions.getExtension<PositronRunAppApiImpl>('vscode.positron-run-app');
		if (!extension) {
			throw new Error('Could not find Positron Run App extension');
		}
		return extension.activate();
	}

	async function verifyRunTestApplication(): Promise<void> {
		await runAppApi.runApplication(options);

		// Check that a terminal was created for the application.
		const terminal = vscode.window.terminals.find((t) => t.name === options.name);
		assert(terminal, 'Terminal not found');

		// Check that the viewer pane was cleared before any other URL was previewed.
		sinon.assert.called(previewUrlStub);
		sinon.assert.calledWith(previewUrlStub.getCall(0), vscode.Uri.parse('about:blank'));
	}

	test('runApplication: shell integration supported', async () => {
		// Run the application.
		await verifyRunTestApplication();

		// Check that the expected command line was executed in the terminal.
		assert(executedCommandLine, 'No terminal shell execution started');
		assert.strictEqual(executedCommandLine, `${runtime.runtimePath} ${uri.fsPath}`, 'Unexpected command line executed');

		// Check that the expected URL was previewed.
		sinon.assert.calledTwice(previewUrlStub);
		sinon.assert.calledWith(previewUrlStub.getCall(1), vscode.Uri.parse(url));
	});

	test('runApplication: shell integration disabled, user enables and reruns', async () => {
		// Disable shell integration.
		await shellIntegrationConfig.update('enabled', false, vscode.ConfigurationTarget.Global);

		// Stub `vscode.window.showInformationMessage` to simulate the user:
		// 1. Enabling shell integration.
		// 2. Rerunning the app.
		const showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage');
		showInformationMessageStub.onFirstCall().resolves('Enable Shell Integration' as any);
		showInformationMessageStub.onSecondCall().resolves('Rerun Application' as any);

		// Stub positron.window.previewUrl and create a promise that resolves when its called with
		// the expected URL.
		const didPreviewExpectedUrlPromise = new Promise<boolean>(resolve => {
			previewUrlStub.withArgs(vscode.Uri.parse(url)).callsFake(() => {
				resolve(true);
			});
		});

		// Run the application.
		await verifyRunTestApplication();

		// Check that the expected text was sent to the terminal.
		assert(sendTextSpy, 'Terminal.sendText spy not created');
		sinon.assert.calledOnceWithExactly(sendTextSpy, `${runtime.runtimePath} ${uri.fsPath}`, true);

		// Check that the server URL was not previewed yet (only a single call to clear the viewer pane).
		sinon.assert.calledOnce(previewUrlStub);

		// Wait for the expected URL to be previewed.
		const didPreviewExpectedUrl = await raceTimeout(didPreviewExpectedUrlPromise, 5_000);
		assert(didPreviewExpectedUrl, 'Timed out waiting for URL preview');

		// Check that shell integration was enabled.
		assert(shellIntegrationConfig.get('enabled'), 'Shell integration not enabled');

		// Check that the expected command line was executed in the terminal i.e. the app was rerun with shell integration.
		assert(executedCommandLine, 'No terminal shell execution started');
		assert.strictEqual(executedCommandLine, `${runtime.runtimePath} ${uri.fsPath}`, 'Unexpected command line executed');

		// Check that the viewer pane was cleared again, and the expected URL was previewed.
		sinon.assert.calledThrice(previewUrlStub);
		sinon.assert.calledWith(previewUrlStub.getCall(1), vscode.Uri.parse('about:blank'));
		sinon.assert.calledWith(previewUrlStub.getCall(2), vscode.Uri.parse(url));
	});
});
