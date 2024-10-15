/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugAdapterTrackerFactory } from './debugAdapterTrackerFactory';
import { Config, log } from './extension';
import { DebugAppOptions, PositronRunApp, RunAppOptions } from './positron-run-app';
import { raceTimeout, removeAnsiEscapeCodes, SequencerByKey } from './utils';

// Regex to match a URL with the format http://localhost:1234/path
const localUrlRegex = /http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})(\/[^\s]*)?/;

type PositronProxyInfo = {
	proxyPath: string;
	externalUri: vscode.Uri;
	finishProxySetup: (targetOrigin: string) => Promise<void>;
};

export class PositronRunAppApiImpl implements PositronRunApp, vscode.Disposable {
	private readonly _debugApplicationSequencerByName = new SequencerByKey<string>();
	private readonly _debugApplicationDisposableByName = new Map<string, vscode.Disposable>();
	private readonly _runApplicationSequencerByName = new SequencerByKey<string>();
	private readonly _runApplicationDisposableByName = new Map<string, vscode.Disposable>();

	constructor(
		private readonly _globalState: vscode.Memento,
		private readonly _debugAdapterTrackerFactory: DebugAdapterTrackerFactory,
	) { }

	public dispose() {
		this._debugApplicationDisposableByName.forEach(disposable => disposable.dispose());
		this._runApplicationDisposableByName.forEach(disposable => disposable.dispose());
	}

	private isShellIntegrationSupported(): boolean {
		return this._globalState.get('shellIntegrationSupported', true);
	}

	public setShellIntegrationSupported(supported: boolean): Thenable<void> {
		return this._globalState.update('shellIntegrationSupported', supported);
	}

	public async runApplication(options: RunAppOptions): Promise<void> {
		// If there's no active text editor, do nothing.
		const document = vscode.window.activeTextEditor?.document;
		if (!document) {
			return;
		}

		if (this._runApplicationSequencerByName.has(options.name)) {
			vscode.window.showErrorMessage(vscode.l10n.t('{0} application is already starting.', options.name));
			return;
		}

		return this.queueRunApplication(document, options);
	}

	private queueRunApplication(document: vscode.TextDocument, options: RunAppOptions): Promise<void> {
		return this._runApplicationSequencerByName.queue(
			options.name,
			() => Promise.resolve(vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Running {0} application', options.name),
			},
				(progress) => this.doRunApplication(document, options, progress),
			)),
		);
	}

	private async doRunApplication(document: vscode.TextDocument, options: RunAppOptions, progress: vscode.Progress<{ message?: string }>): Promise<void> {
		// Dispose existing disposables for the application, if any.
		this._runApplicationDisposableByName.get(options.name)?.dispose();
		this._runApplicationDisposableByName.delete(options.name);

		// Save the active document if it's dirty.
		if (document.isDirty) {
			await document.save();
		}

		// Get the preferred runtime for the document's language.
		progress.report({ message: vscode.l10n.t('Getting interpreter information...') });
		const runtime = await this.getPreferredRuntime(document.languageId);
		if (!runtime) {
			return;
		}

		// Get the terminal options for the application.
		progress.report({ message: vscode.l10n.t('Getting terminal options...') });
		// Start the proxy server
		const proxyInfo = await vscode.commands.executeCommand<PositronProxyInfo>('positronProxy.startPendingProxyServer');
		log.debug(`Proxy started for app at proxy path ${proxyInfo.proxyPath} with uri ${proxyInfo.externalUri.toString()}`);
		const urlPrefix = proxyInfo.proxyPath;
		const terminalOptions = await options.getTerminalOptions(runtime, document, urlPrefix);
		if (!terminalOptions) {
			return;
		}

		// Show shell integration prompts and check if shell integration is:
		// - enabled in the workspace, and
		// - supported in the terminal.
		const isShellIntegrationEnabledAndSupported = this.showShellIntegrationMessages(
			() => this.queueRunApplication(document, options)
		);

		// Get existing terminals with the application's name.
		const existingTerminals = vscode.window.terminals.filter((t) => t.name === options.name);

		// Create a new terminal for the application.
		const terminal = vscode.window.createTerminal({
			name: options.name,
			env: terminalOptions.env,
		});

		// Reveal the new terminal.
		terminal.show(true);

		// Wait for existing terminals to close, or a timeout.
		progress.report({ message: vscode.l10n.t('Closing existing terminals...') });
		await raceTimeout(
			Promise.allSettled(existingTerminals.map((terminal) => {
				// Create a promise that resolves when the terminal is closed.
				// Note that the application process may still be running once this promise resolves.
				const terminalDidClose = new Promise<void>((resolve) => {
					const disposable = vscode.window.onDidCloseTerminal((closedTerminal) => {
						if (closedTerminal === terminal) {
							disposable.dispose();
							resolve();
						}
					});
				});

				// Close the terminal.
				terminal.dispose();

				return terminalDidClose;
			})),
			5000,
			() => log.warn('Timed out waiting for existing terminals to close. Proceeding anyway'),
		);

		// Create a disposables store for this session.

		// Create a promise that resolves when the server URL has been previewed,
		// or an error has occurred, or it times out.
		const didPreviewUrl = raceTimeout(
			new Promise<boolean>((resolve) => {
				const disposable = vscode.window.onDidStartTerminalShellExecution(async e => {
					// Remember that shell integration is supported.
					await this.setShellIntegrationSupported(true);

					if (e.terminal === terminal) {
						const didPreviewUrl = await previewUrlInExecutionOutput(e.execution, proxyInfo, options.urlPath);
						if (didPreviewUrl) {
							resolve(didPreviewUrl);
						}
					}
				});
				this._runApplicationDisposableByName.set(options.name, disposable);
			}),
			10_000,
			async () => {
				await this.setShellIntegrationSupported(false);
			});

		// Execute the command.
		progress.report({ message: vscode.l10n.t('Starting application...') });
		terminal.sendText(terminalOptions.commandLine, true);

		if (isShellIntegrationEnabledAndSupported && !await didPreviewUrl) {
			log.warn('Failed to preview URL using shell integration');
			// TODO: If a port was provided, we could poll the server until it responds,
			//       then open the URL in the viewer pane.
		}
	}

	public async debugApplication(options: DebugAppOptions): Promise<void> {
		// If there's no active text editor, do nothing.
		const document = vscode.window.activeTextEditor?.document;
		if (!document) {
			return;
		}

		if (this._debugApplicationSequencerByName.has(options.name)) {
			vscode.window.showErrorMessage(vscode.l10n.t('{0} application is already starting.', options.name));
			return;
		}

		return this.queueDebugApplication(document, options);
	}

	private queueDebugApplication(document: vscode.TextDocument, options: DebugAppOptions): Promise<void> {
		return this._debugApplicationSequencerByName.queue(
			options.name,
			() => Promise.resolve(vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Debugging {0} application', options.name),
			},
				(progress) => this.doDebugApplication(document, options, progress),
			)),
		);
	}

	private async doDebugApplication(document: vscode.TextDocument, options: DebugAppOptions, progress: vscode.Progress<{ message?: string }>): Promise<void> {
		// Dispose existing disposables for the application, if any.
		this._debugApplicationDisposableByName.get(options.name)?.dispose();
		this._debugApplicationDisposableByName.delete(options.name);

		// Save the active document if it's dirty.
		if (document.isDirty) {
			await document.save();
		}

		// Get the preferred runtime for the document's language.
		progress.report({ message: vscode.l10n.t('Getting interpreter information...') });
		const runtime = await this.getPreferredRuntime(document.languageId);
		if (!runtime) {
			return;
		}

		// Get the debug config for the application.
		progress.report({ message: vscode.l10n.t('Getting debug configuration...') });
		// Start the proxy server
		const proxyInfo = await vscode.commands.executeCommand<PositronProxyInfo>('positronProxy.startPendingProxyServer');
		const urlPrefix = proxyInfo.proxyPath;
		const debugConfig = await options.getDebugConfiguration(runtime, document, urlPrefix);
		if (!debugConfig) {
			return;
		}

		// Show shell integration prompts and check if shell integration is:
		// - enabled in the workspace, and
		// - supported in the terminal.
		const isShellIntegrationEnabledAndSupported = this.showShellIntegrationMessages(
			() => this.queueDebugApplication(document, options)
		);

		// Stop the application's current debug session, if one exists.
		const activeDebugSession = vscode.debug.activeDebugSession;
		if (activeDebugSession?.name === debugConfig.name) {
			progress.report({ message: vscode.l10n.t('Stopping existing debug session...') });
			await vscode.debug.stopDebugging(activeDebugSession);
		}

		const debugAppRequestId = debugConfig.debugAppRequestId = randomUUID();

		// Create a promise that resolves when the server URL has been previewed,
		// or an error has occurred, or it times out.
		const didPreviewUrl = raceTimeout(
			new Promise<boolean>((resolve) => {
				let executionDisposable: vscode.Disposable | undefined;
				const disposable = this._debugAdapterTrackerFactory.onDidRequestRunInTerminal(e => {
					if (e.debugSession.configuration.debugAppRequestId === debugAppRequestId) {
						// Dispose the existing terminal execution listener, if any.
						executionDisposable?.dispose();

						const { processId } = e;
						executionDisposable = vscode.window.onDidStartTerminalShellExecution(async e => {
							// Remember that shell integration is supported.
							await this.setShellIntegrationSupported(true);

							if (await e.terminal.processId === processId) {
								const didPreviewUrl = await previewUrlInExecutionOutput(e.execution, proxyInfo, options.urlPath);
								if (didPreviewUrl) {
									resolve(didPreviewUrl);
								}
							}
						});
					}
				});
				this._debugApplicationDisposableByName.set(options.name, disposable);
			}),
			10_000,
			async () => {
				await this.setShellIntegrationSupported(false);
			});

		// Start the debug session.
		progress.report({ message: vscode.l10n.t('Starting application...') });
		await vscode.debug.startDebugging(undefined, debugConfig);

		// Wait for the server URL to be previewed, or a timeout.
		if (isShellIntegrationEnabledAndSupported && !await didPreviewUrl) {
			log.warn('Failed to preview URL using shell integration');
		}
	}

	/** Get the preferred runtime for a language; forwarding errors to the UI. */
	private async getPreferredRuntime(languageId: string): Promise<positron.LanguageRuntimeMetadata | undefined> {
		try {
			return await positron.runtime.getPreferredRuntime(languageId);
		} catch (error) {
			vscode.window.showErrorMessage(
				vscode.l10n.t(
					"Failed to get '{0}' interpreter information. Error: {1}",
					languageId,
					error.message
				),
			);
		}
		return undefined;
	}

	private showShellIntegrationMessages(rerunApplicationCallback: () => any): boolean {
		// Check if shell integration is enabled in the workspace.
		const isShellIntegrationEnabled = vscode.workspace.getConfiguration().get<boolean>(Config.ShellIntegrationEnabled, false);

		// Check if shell integration was detected as supported in a previous application run.
		const isShellIntegrationSupported = this.isShellIntegrationSupported();

		if (isShellIntegrationEnabled) {
			if (!isShellIntegrationSupported) {
				// Show a message indicating that shell integration is not supported.
				showShellIntegrationNotSupportedMessage();
			}
		} else {
			// Show a message to enable shell integration and rerun the application.
			showEnableShellIntegrationMessage(async () => {
				await this.setShellIntegrationSupported(true);
				rerunApplicationCallback();
			});
		}

		return isShellIntegrationEnabled && isShellIntegrationSupported;
	}
}

async function previewUrlInExecutionOutput(execution: vscode.TerminalShellExecution, proxyInfo: PositronProxyInfo, urlPath?: string) {
	// Wait for the server URL to appear in the terminal output, or a timeout.
	const stream = execution.read();
	const url = await raceTimeout(
		(async () => {
			for await (const data of stream) {
				log.warn('Execution:', execution.commandLine.value, data);
				// Ansi escape codes seem to mess up the regex match on Windows, so remove them first.
				const dataCleaned = removeAnsiEscapeCodes(data);
				const match = dataCleaned.match(localUrlRegex)?.[0];
				if (match) {
					return new URL(match.trim());
				}
			}
			log.warn('URL not found in terminal output');
			return undefined;
		})(),
		15_000,
	);

	if (url === undefined) {
		log.warn('Timed out waiting for server URL in terminal output');
		return false;
	}

	// Convert the url to an external URI.
	const localBaseUri = vscode.Uri.parse(url.toString());
	const localUri = urlPath ?
		vscode.Uri.joinPath(localBaseUri, urlPath) : localBaseUri;

	log.debug(`Viewing app at local uri: ${localUri} with external uri ${proxyInfo.externalUri.toString()}`);

	// Finish the Positron proxy setup so that proxy middleware is hooked up.
	await proxyInfo.finishProxySetup(localUri.toString());

	// Preview the external URI.
	positron.window.previewUrl(proxyInfo.externalUri);

	return true;
}

async function showEnableShellIntegrationMessage(rerunApplicationCallback: () => any): Promise<void> {
	// Don't show if the user disabled this message.
	if (!vscode.workspace.getConfiguration().get<boolean>(Config.ShowEnableShellIntegrationMessage)) {
		return;
	}

	// Prompt the user to enable shell integration.
	const enableShellIntegration = vscode.l10n.t('Enable Shell Integration');
	const notNow = vscode.l10n.t('Not Now');
	const dontAskAgain = vscode.l10n.t('Don\'t Ask Again');
	const selection = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			'Shell integration is disabled. Would you like to enable shell integration for this ' +
			'workspace to automatically preview your application in the Viewer pane?',
		),
		enableShellIntegration,
		notNow,
		dontAskAgain,
	);

	if (selection === enableShellIntegration) {
		// Enable shell integration.
		const shellIntegrationConfig = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration');
		await shellIntegrationConfig.update('enabled', true, vscode.ConfigurationTarget.Workspace);

		// Prompt the user to rerun the application.
		const rerunApplication = vscode.l10n.t('Rerun Application');
		const notNow = vscode.l10n.t('Not Now');
		const selection = await vscode.window.showInformationMessage(
			vscode.l10n.t('Shell integration is now enabled. Would you like to rerun the application?'),
			rerunApplication,
			notNow,
		);

		if (selection === rerunApplication) {
			// Rerun the application.
			rerunApplicationCallback();
		}
	} else if (selection === dontAskAgain) {
		// Disable the prompt for future runs.
		const runAppConfig = vscode.workspace.getConfiguration('positron.runApplication');
		await runAppConfig.update('showShellIntegrationPrompt', false, vscode.ConfigurationTarget.Global);
	}
}

async function showShellIntegrationNotSupportedMessage(): Promise<void> {
	// Don't show if the user disabled this message.
	if (!vscode.workspace.getConfiguration().get<boolean>(Config.ShowShellIntegrationNotSupportedMessage)) {
		return;
	}

	const learnMore = vscode.l10n.t('Learn More');
	const dismiss = vscode.l10n.t('Dismiss');
	const dontShowAgain = vscode.l10n.t('Don\'t Show Again');
	const selection = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			'Shell integration isn\'t supported in this terminal, ' +
			'so automatic preview in the Viewer pane isn\'t available. ' +
			'To use this feature, please switch to a terminal that supports shell integration.'
		),
		learnMore,
		dismiss,
		dontShowAgain,
	);

	if (selection === learnMore) {
		await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/terminal/shell-integration'));
	} else if (selection === dontShowAgain) {
		// Disable the prompt for future runs.
		const runAppConfig = vscode.workspace.getConfiguration('positron.runApplication');
		await runAppConfig.update('showShellIntegrationNotSupportedMessage', false, vscode.ConfigurationTarget.Global);
	}
}
