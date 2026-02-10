/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert = require('assert');
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DebugAppOptions, RunAppOptions } from '../positron-run-app';
import { raceTimeout } from '../utils';
import { PositronRunAppApiImpl } from '../api';
import { log } from '../extension.js';

suite('PositronRunApp', () => {
	// Use a test runtime with a runtimePath of `cat` so that executing a file
	// will simply print its contents to the terminal.
	const runtime = {
		runtimePath: 'node',
	} as positron.LanguageRuntimeMetadata;

	// Options for running the test application.
	const runAppOptions: RunAppOptions = {
		name: 'Test App',
		getTerminalOptions(runtime, document, _urlPrefix) {
			return {
				commandLine: [runtime.runtimePath, document.uri.fsPath].join(' '),
			};
		},
	};

	// Options for debugging the test application.
	const debugAppOptions: DebugAppOptions = {
		name: 'Test App',
		getDebugConfiguration(_runtime, document, _urlPrefix) {
			return {
				name: 'Launch Test App',
				type: 'node',
				request: 'launch',
				program: document.uri.fsPath,
				// Use the terminal since we rely on shell integration.
				console: 'integratedTerminal',
			};
		},
	};

	// Matches a server URL on localhost.
	const localhostUriMatch = sinon.match((uri: vscode.Uri) =>
		uri.scheme === 'http' && /localhost:\d+/.test(uri.authority));

	const disposables = new Array<vscode.Disposable>();

	let uri: vscode.Uri;
	let previewUrlStub: sinon.SinonStub;
	let runAppApi: PositronRunAppApiImpl;

	setup(async () => {
		// Reroute log messages to the console.
		for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
			sinon.stub(log, level as keyof typeof log).callsFake((...args) => {
				console.info('[PositronRunApp]', ...args);
			});
		}

		// Open the test app. Assumes that the tests are run in the ../test-workspace workspace.
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder, 'This test should be run from the ../test-workspace workspace');
		uri = vscode.Uri.joinPath(workspaceFolder.uri, 'app.js');
		await vscode.window.showTextDocument(uri);

		// Stub the runtime API to return the test runtime.
		sinon.stub(positron.runtime, 'getPreferredRuntime').callsFake(async (_languageId) => runtime);

		// Stub the positron proxy API.
		sinon.stub(vscode.commands, 'executeCommand')
			.withArgs('positronProxy.startPendingProxyServer')
			.resolves({
				proxyPath: '/proxy/path',
				externalUri: vscode.Uri.parse('http://localhost:1234'),
				finishProxySetup: () => { },
			});

		// Stub the preview URL function.
		previewUrlStub = sinon.stub(positron.window, 'previewUrl');

		// Enable shell integration.
		await vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').update('enabled', true);

		runAppApi = await getRunAppApi();
		runAppApi.setShellIntegrationSupported(true);
	});

	teardown(async () => {
		sinon.restore();
		await vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').update('enabled', undefined);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		disposables.forEach(d => d.dispose());
		disposables.splice(0, disposables.length);
	});

	async function getRunAppApi(): Promise<PositronRunAppApiImpl> {
		const extension = vscode.extensions.getExtension<PositronRunAppApiImpl>('positron.positron-run-app');
		if (!extension) {
			throw new Error('Could not find Positron Run App extension');
		}
		return extension.activate();
	}

	async function verifyRunTestApplication(): Promise<void> {
		await runAppApi.runApplication(runAppOptions);

		// Check that a terminal was created for the application.
		const terminal = vscode.window.terminals.find((t) => t.name === runAppOptions.name);
		assert.ok(terminal, 'Terminal not found');
	}

	test('appLauncher: shell integration supported', async () => {
		// Run the application.
		await verifyRunTestApplication();

		// Check that the expected URL was previewed.
		sinon.assert.calledOnceWithMatch(previewUrlStub, localhostUriMatch);
	});

	test('applauncher: shell integration disabled', async () => {
		// Disable shell integration.
		await vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').update('enabled', false);

		// Run the application.
		await verifyRunTestApplication();

		// Check that the expected URL was not previewed.
		sinon.assert.notCalled(previewUrlStub);
	});

	test('appLauncher: shell integration disabled, user enables and reruns', async () => {
		// Disable shell integration.
		await vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').update('enabled', false);

		// Stub `vscode.window.showInformationMessage` to simulate the user:
		// 1. Enabling shell integration.
		// 2. Rerunning the app.
		const showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage');
		showInformationMessageStub.onFirstCall().resolves('Enable Shell Integration' as unknown as vscode.MessageItem);
		showInformationMessageStub.onSecondCall().resolves('Rerun Application' as unknown as vscode.MessageItem);

		// Stub positron.window.previewUrl and create a promise that resolves when its called with
		// the expected URL.
		const didPreviewExpectedUrlPromise = new Promise<boolean>(resolve => {
			previewUrlStub.withArgs(localhostUriMatch).callsFake(() => {
				resolve(true);
			});
		});

		// Run the application.
		await verifyRunTestApplication();

		// Wait for the expected URL to be previewed.
		const didPreviewExpectedUrl = await raceTimeout(didPreviewExpectedUrlPromise, 10_000);
		assert.ok(didPreviewExpectedUrl, 'Timed out waiting for URL preview');

		// Check that shell integration was enabled.
		assert.ok(
			vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').get('enabled'),
			'Shell integration not enabled',
		);
	});

	test('debugApplication: shell integration supported', async () => {
		// Debug the test application.
		await runAppApi.debugApplication(debugAppOptions);

		// Check that the expected URL was previewed.
		sinon.assert.calledOnceWithMatch(previewUrlStub, localhostUriMatch);
	});

	test('debugApplication: shell integration disabled', async () => {
		// Disable shell integration.
		await vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').update('enabled', false);

		// Debug the test application.
		await runAppApi.debugApplication(debugAppOptions);

		// Check that the expected URL was not previewed.
		sinon.assert.notCalled(previewUrlStub);
	});

	test('debugApplication: shell integration disabled, user enables and reruns', async () => {
		// Disable shell integration.
		await vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').update('enabled', false);

		// Stub `vscode.window.showInformationMessage` to simulate the user:
		// 1. Enabling shell integration.
		// 2. Rerunning the app.
		const showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage');
		showInformationMessageStub.onFirstCall().resolves('Enable Shell Integration' as unknown as vscode.MessageItem);
		showInformationMessageStub.onSecondCall().resolves('Rerun Application' as unknown as vscode.MessageItem);

		// Stub positron.window.previewUrl and create a promise that resolves when its called with
		// the expected URL.
		const didPreviewExpectedUrlPromise = new Promise<boolean>(resolve => {
			previewUrlStub.withArgs(localhostUriMatch).callsFake(() => {
				resolve(true);
			});
		});

		// Run the debug application.
		await runAppApi.debugApplication(debugAppOptions);

		// Wait for the expected URL to be previewed.
		const didPreviewExpectedUrl = await raceTimeout(didPreviewExpectedUrlPromise, 10_000);
		assert.ok(didPreviewExpectedUrl, 'Timed out waiting for URL preview');

		// Check that shell integration was enabled.
		vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').get('enabled', false);
	});
});
