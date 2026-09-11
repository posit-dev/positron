/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert = require('assert');
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DebugAppOptions, RunAppOptions, RunConsoleAppOptions } from '../positron-run-app';
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
		// Call through for every other command: tests rely on real commands
		// (e.g. workbench.action.closeAllEditors), which a bare stub would
		// silently turn into no-ops.
		const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand');
		executeCommandStub.callThrough();
		executeCommandStub
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

	/** Poll until `condition` holds, or fail the test after `timeout` ms. */
	async function waitFor(condition: () => boolean, message: string, timeout = 5_000): Promise<void> {
		const deadline = Date.now() + timeout;
		while (!condition()) {
			if (Date.now() > deadline) {
				assert.fail(message);
			}
			await new Promise(resolve => setTimeout(resolve, 10));
		}
	}

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

	test('appLauncher: document option runs the given document without relying on the active editor', async () => {
		// Close all editors so the active-editor fallback can't be what runs.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await waitFor(() => vscode.window.activeTextEditor === undefined, 'Editors did not close');
		const document = await vscode.workspace.openTextDocument(uri);

		await runAppApi.runApplication({ ...runAppOptions, document });

		const terminal = vscode.window.terminals.find((t) => t.name === runAppOptions.name);
		assert.ok(terminal, 'Terminal not found');
		sinon.assert.calledOnceWithMatch(previewUrlStub, localhostUriMatch);
	});

	test('appLauncher: no document and no active editor runs nothing', async () => {
		// With nothing to fall back to there is no app to run, so the run is a
		// no-op rather than an error: only a programmatic caller can reach this.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await waitFor(() => vscode.window.activeTextEditor === undefined, 'Editors did not close');
		// Earlier tests leave their terminals open, so count rather than look one up by name.
		const terminalCount = vscode.window.terminals.length;

		await runAppApi.runApplication(runAppOptions);

		assert.strictEqual(vscode.window.terminals.length, terminalCount, 'No terminal should have been created');
		sinon.assert.notCalled(previewUrlStub);
	});

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

	suite('runApplicationInConsole', () => {
		const consoleAppOptions: RunConsoleAppOptions = {
			name: 'Test Console App',
			getConsoleCode() {
				return { code: 'run_the_app()' };
			},
			appUrlStrings: ['Listening on {{APP_URL}}'],
			// Generous by default: the success test has to wait for `executeCode`
			// before it can emit output, and a loaded CI machine must not race the
			// detection clock. The timeout test overrides this with a short value.
			urlDetectionTimeout: 30_000,
		};

		let observer: positron.runtime.ExecutionObserver | undefined;
		let finishExecution: (() => void) | undefined;
		let showWarningMessageStub: sinon.SinonStub;

		setup(() => {
			observer = undefined;
			finishExecution = undefined;

			// Always start a fresh console session rather than reusing a
			// persisted one from an earlier test.
			sinon.stub(positron.runtime, 'getSession').resolves(undefined);
			sinon.stub(positron.runtime, 'startLanguageRuntime')
				.resolves({ metadata: { sessionId: 'test-session' } } as positron.LanguageRuntimeSession);
			sinon.stub(positron.runtime, 'focusSession');

			// Capture the observer so the test can drive console output, and
			// capture a resolver so a test can end the execution: the real
			// Thenable only resolves once the app stops.
			sinon.stub(positron.runtime, 'executeCode')
				.callsFake((..._args) => {
					observer = _args[6] as positron.runtime.ExecutionObserver;
					return new Promise<Record<string, any>>(resolve => {
						finishExecution = () => resolve({});
					});
				});

			showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
		});

		test('previews the app URL found in console output', async () => {
			const runPromise = runAppApi.runApplicationInConsole(consoleAppOptions);

			// Wait for the execution to start, then emit the app's URL.
			await waitFor(() => observer !== undefined, 'Timed out waiting for code execution');
			observer!.onOutput!('Listening on http://localhost:1234\n');

			await runPromise;

			sinon.assert.calledOnceWithMatch(previewUrlStub, localhostUriMatch);
		});

		test('leaves the app running when URL detection times out', async () => {
			// Regression test for #15601: the URL detection timeout used to
			// cancel the execution observer's token. Cancelling that token
			// interrupts the session, which killed apps that were merely slower
			// to start than the timeout allowed, so the app's port was never
			// forwarded.
			let didCancelExecution = false;

			// Short timeout so this test doesn't slow the suite down.
			const runPromise = runAppApi.runApplicationInConsole({
				...consoleAppOptions,
				urlDetectionTimeout: 500,
			});

			await waitFor(() => observer !== undefined, 'Timed out waiting for code execution');
			observer!.token?.onCancellationRequested(() => {
				didCancelExecution = true;
			});

			// Never emit a URL, so detection times out.
			await runPromise;

			// Stated directly rather than relying on the listener above: with no
			// token there is nothing to cancel, so an optional-chained listener
			// alone would pass no matter what the code did.
			assert.strictEqual(
				observer!.token,
				undefined,
				'The execution observer must not carry a cancellation token: cancelling it ' +
				'interrupts the session and kills the app',
			);
			assert.ok(
				!didCancelExecution,
				'URL detection timing out must not cancel the execution, which would interrupt the ' +
				'session and kill the app',
			);
			sinon.assert.notCalled(previewUrlStub);

			// These options set `urlDetectionTimeout`, which overrides
			// `positron.runApp.urlDetectionTimeout`, so the warning must not offer
			// to change that setting: changing it would have no effect.
			sinon.assert.calledOnceWithExactly(
				showWarningMessageStub,
				sinon.match.string,
				'Show Console',
				'Show Log',
			);
		});

		test('previews the app URL that appears after the detection timeout', async () => {
			// A slow app prints its URL after we have given up waiting. Detection
			// keeps listening, so the app is still previewed without the user
			// having to do anything.
			const runPromise = runAppApi.runApplicationInConsole({
				...consoleAppOptions,
				urlDetectionTimeout: 500,
			});

			await waitFor(() => observer !== undefined, 'Timed out waiting for code execution');

			// The run task ends at the timeout so that a re-run is never blocked.
			// The watch for the app's URL outlives it.
			await runPromise;

			observer!.onOutput!('Listening on http://localhost:1234\n');

			await waitFor(() => previewUrlStub.called, 'Timed out waiting for the app to be previewed');
			sinon.assert.calledOnceWithMatch(previewUrlStub, localhostUriMatch);
		});

		test('stops watching when the console execution finishes without a URL', async () => {
			// An app that stopped without ever printing a URL is never going to
			// print one, so the watch must end with the execution rather than
			// previewing whatever a later session happens to print.
			const runPromise = runAppApi.runApplicationInConsole({
				...consoleAppOptions,
				urlDetectionTimeout: 500,
			});

			await waitFor(() => observer !== undefined, 'Timed out waiting for code execution');
			await runPromise;

			// End the execution, as if the app stopped, then print a URL anyway.
			assert.ok(finishExecution, 'The execution resolver should have been captured');
			finishExecution();
			await new Promise(resolve => setTimeout(resolve, 100));
			observer!.onOutput!('Listening on http://localhost:1234\n');
			await new Promise(resolve => setTimeout(resolve, 500));

			sinon.assert.notCalled(previewUrlStub);
		});
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
