/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugAdapterTrackerFactory } from './debugAdapterTrackerFactory';
import { Config, log } from './extension';
import { AppUrlString, DebugAppOptions, PositronRunApp, RunAppOptions } from './positron-run-app';
import { raceTimeout, removeAnsiEscapeCodes, SequencerByKey } from './utils';

// Regex to match a string that starts with http:// or https://.
const httpUrlRegex = /((https?:\/\/)([a-zA-Z0-9.-]+)(:\d{1,5})?(\/[^\s]*)?)/;
// A more permissive URL regex to be used with the AppUrlString type.
const urlLikeRegex = /((https?:\/\/)?([a-zA-Z0-9.-]*[.:][a-zA-Z0-9.-]*)(:\d{1,5})?(\/[^\s]*)?)/;

// App URL Placeholder string.
const APP_URL_PLACEHOLDER = '{{APP_URL}}';

// Flags to determine where Positron is running.
const isPositronWeb = vscode.env.uiKind === vscode.UIKind.Web;
const isRunningOnPwb = !!process.env.RS_SERVER_URL && isPositronWeb;

// Timeouts.
const terminalOutputTimeout = 25_000;
const didPreviewUrlTimeout = terminalOutputTimeout + 5_000;

type PositronProxyInfo = {
	proxyPath: string;
	externalUri: vscode.Uri;
	finishProxySetup: (targetOrigin: string) => Promise<void>;
};

type AppPreviewOptions = {
	proxyInfo?: PositronProxyInfo;
	urlPath?: string;
	appReadyMessage?: string;
	appUrlStrings?: AppUrlString[];
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

		// Set up the proxy server for the application if applicable.
		let urlPrefix = undefined;
		let proxyInfo: PositronProxyInfo | undefined;
		if (shouldUsePositronProxy(options.name)) {
			// Start the proxy server
			proxyInfo = await vscode.commands.executeCommand<PositronProxyInfo>('positronProxy.startPendingProxyServer');
			log.debug(`Proxy started for app at proxy path ${proxyInfo.proxyPath} with uri ${proxyInfo.externalUri.toString()}`);
			urlPrefix = proxyInfo.proxyPath;
		}

		// Get the terminal options for the application.
		progress.report({ message: vscode.l10n.t('Getting terminal options...') });
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
						const previewOptions: AppPreviewOptions = {
							proxyInfo,
							urlPath: options.urlPath,
							appReadyMessage: options.appReadyMessage,
							appUrlStrings: options.appUrlStrings,
						};
						const didPreviewUrl = await previewUrlInExecutionOutput(e.execution, previewOptions);
						if (didPreviewUrl) {
							resolve(didPreviewUrl);
						}
					}
				});
				this._runApplicationDisposableByName.set(options.name, disposable);
			}),
			didPreviewUrlTimeout,
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

		// Set up the proxy server for the application if applicable.
		let urlPrefix = undefined;
		let proxyInfo: PositronProxyInfo | undefined;
		if (shouldUsePositronProxy(options.name)) {
			// Start the proxy server
			proxyInfo = await vscode.commands.executeCommand<PositronProxyInfo>('positronProxy.startPendingProxyServer');
			log.debug(`Proxy started for app at proxy path ${proxyInfo.proxyPath} with uri ${proxyInfo.externalUri.toString()}`);
			urlPrefix = proxyInfo.proxyPath;
		}

		// Get the debug config for the application.
		progress.report({ message: vscode.l10n.t('Getting debug configuration...') });
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
								const previewOptions: AppPreviewOptions = {
									proxyInfo,
									urlPath: options.urlPath,
									appReadyMessage: options.appReadyMessage,
									appUrlStrings: options.appUrlStrings,
								};
								const didPreviewUrl = await previewUrlInExecutionOutput(e.execution, previewOptions);
								if (didPreviewUrl) {
									resolve(didPreviewUrl);
								}
							}
						});
					}
				});
				this._debugApplicationDisposableByName.set(options.name, disposable);
			}),
			didPreviewUrlTimeout,
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

async function previewUrlInExecutionOutput(execution: vscode.TerminalShellExecution, options: AppPreviewOptions) {
	// Wait for the server URL to appear in the terminal output, or a timeout.
	const stream = execution.read();
	const appReadyMessage = options.appReadyMessage?.trim();
	const url = await raceTimeout(
		(async () => {
			// If an appReadyMessage is not provided, we'll consider the app ready as soon as the URL is found.
			let appReady = !appReadyMessage;
			let appUrl = undefined;
			for await (const data of stream) {
				log.trace('Execution:', execution.commandLine.value, data);

				// Ansi escape codes seem to mess up the regex match on Windows, so remove them first.
				const dataCleaned = removeAnsiEscapeCodes(data);

				// Check if the app is ready, if it's not already ready and an appReadyMessage is provided.
				if (!appReady && appReadyMessage) {
					appReady = dataCleaned.includes(appReadyMessage);
					if (appReady) {
						log.debug(`App is ready - found appReadyMessage: '${appReadyMessage}'`);
						// If the app URL was already found, we're done!
						if (appUrl) {
							return appUrl;
						}
					}
				}
				// Check if the app url is found in the terminal output.
				if (!appUrl) {
					const match = extractAppUrlFromString(dataCleaned, options.appUrlStrings);
					if (match) {
						appUrl = new URL(match);
						log.debug(`Found app URL in terminal output: ${appUrl.toString()}`);
						// If the app is ready, we're done!
						if (appReady) {
							return appUrl;
						}
					}
				}
			}

			// If we're here, we've reached the end of the stream without finding the app URL and/or
			// the appReadyMessage.
			if (!appReady) {
				// It's possible that the app is ready, but the appReadyMessage was not found, for
				// example, if the message has changed or was missed somehow. Log a warning.
				log.warn(`Expected app ready message '${appReadyMessage}' not found in terminal`);
			}
			if (!appUrl) {
				log.error('App URL not found in terminal output');
			}
			return appUrl;
		})(),
		terminalOutputTimeout,
		() => log.error('Timed out waiting for server output in terminal'),
	);

	if (!url) {
		log.error('Cannot preview URL. App is not ready or URL not found in terminal output.');
		return false;
	}

	// Example: http://localhost:8500
	const localBaseUri = vscode.Uri.parse(url.toString());

	// Example: http://localhost:8500/url/path or http://localhost:8500
	const localUri = options.urlPath ?
		vscode.Uri.joinPath(localBaseUri, options.urlPath) : localBaseUri;

	// Example: http://localhost:8080/proxy/5678/url/path or http://localhost:8080/proxy/5678
	let previewUri = undefined;
	if (options.proxyInfo) {
		// On Web (specifically Positron Server Web and not PWB), we need to set up the proxy with
		// the urlPath appended to avoid issues where the app does not set the base url of the app
		// or the base url of referenced assets correctly.
		const applyWebPatch = isPositronWeb && !isRunningOnPwb;
		const targetOrigin = applyWebPatch ? localUri.toString(true) : localBaseUri.toString();

		log.debug(`Finishing proxy setup for app at ${targetOrigin}`);

		// Finish the Positron proxy setup so that proxy middleware is hooked up.
		await options.proxyInfo.finishProxySetup(targetOrigin);
		previewUri = !applyWebPatch && options.urlPath
			? vscode.Uri.joinPath(options.proxyInfo.externalUri, options.urlPath)
			: options.proxyInfo.externalUri;
	} else {
		previewUri = await vscode.env.asExternalUri(localUri);
	}

	log.debug(`Viewing app at local uri: ${localUri.toString(true)} with external uri ${previewUri.toString(true)}`);

	// Preview the app in the Viewer.
	positron.window.previewUrl(previewUri);

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

/**
 * Check if the Positron proxy should be used for the given app.
 * Generally, we should avoid skipping the proxy unless there is a good reason to do so, as the
 * proxy gives us the ability to intercept requests and responses to the app, which is useful for
 * things like debugging, applying styling or fixing up urls.
 * @param appName The name of the app; indicated in extensions/positron-python/src/client/positron/webAppCommands.ts
 * @returns Whether to use the Positron proxy for the app.
 */
function shouldUsePositronProxy(appName: string) {
	switch (appName.trim().toLowerCase()) {
		// Streamlit apps don't work in Positron on Workbench with SSL enabled when run through the proxy.
		case 'streamlit':
		// FastAPI apps don't work in Positron on Workbench when run through the proxy.
		case 'fastapi':
			if (isRunningOnPwb) {
				return false;
			}
			return true;
		default:
			// By default, proxy the app.
			return true;
	}
}

/**
 * Extracts a URL from a string using the provided appUrlStrings.
 * @param str The string to match the URL in.
 * @param appUrlStrings An array of app url strings to match and extract the URL from.
 * @returns The matched URL, or undefined if no URL is found.
 */
function extractAppUrlFromString(str: string, appUrlStrings?: AppUrlString[]) {
	if (appUrlStrings && appUrlStrings.length > 0) {
		// Try to match any of the provided appUrlStrings.
		log.debug('Attempting to match URL with:', appUrlStrings);
		for (const appUrlString of appUrlStrings) {
			const pattern = appUrlString.replace(APP_URL_PLACEHOLDER, urlLikeRegex.source);
			const appUrlRegex = new RegExp(pattern);

			const match = str.match(appUrlRegex);
			if (match) {
				const endsWithAppUrl = appUrlString.endsWith(APP_URL_PLACEHOLDER);
				// Placeholder is at the end of the string. This is the most common case.
				// Example: 'The app is running at {{APP_URL}}'
				// [0] = 'The app is running at ', [1] = '{{APP_URL}}'
				// Also covers the case where the placeholder is the entire string.
				if (endsWithAppUrl) {
					return match[1];
				}

				const startsWithAppUrl = appUrlString.startsWith(APP_URL_PLACEHOLDER);
				// Placeholder is at the start of the string.
				// Example: '{{APP_URL}} is where the app is running'
				// [0] = '{{APP_URL}}', [1] = ' is where the app is running'
				if (startsWithAppUrl) {
					return match[0];
				}

				// Placeholder is in the middle of the string.
				// Example: 'Open {{APP_URL}} to view the app'
				// [0] = 'Open ', [1] = '{{APP_URL}}', [2] = ' to view the app'
				return match[1];
			}
		}
	}

	// Fall back to the default URL regex if no appUrlStrings were provided or matched.
	log.debug('No appUrlStrings matched. Falling back to default URL regex to match URL.');
	return str.match(httpUrlRegex)?.[0];
}
