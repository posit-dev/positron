/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugAdapterTrackerFactory } from './debugAdapterTrackerFactory';
import { log } from './extension';
import { DebugAppOptions, PositronRunApp, RunAppOptions } from './positron-run-app';
import { raceTimeout, removeAnsiEscapeCodes, SequencerByKey } from './utils';
import { DID_PREVIEW_URL_TIMEOUT, IS_POSITRON_WEB, IS_RUNNING_ON_PWB, SHELL_INTEGRATION_TIMEOUT, TERMINAL_OUTPUT_TIMEOUT } from './constants.js';
import { AppPreviewOptions, Config, PositronProxyInfo } from './types.js';
import { shouldUsePositronProxy, showShellIntegrationNotSupportedMessage, showEnableShellIntegrationMessage, extractAppUrlFromString } from './api-utils.js';


export class PositronRunAppApiImpl implements PositronRunApp, vscode.Disposable {
	private readonly _debugApplicationSequencerByName = new SequencerByKey<string>();
	private readonly _debugApplicationDisposableByName = new Map<string, vscode.Disposable>();
	private readonly _runApplicationSequencerByName = new SequencerByKey<string>();
	private readonly _runApplicationDisposableByName = new Map<string, vscode.Disposable>();
	private readonly _appServers = new Map<string, { terminalPid: number | undefined; proxyUri: vscode.Uri }>();

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

	public getProxyServerUri(appUrl: string): vscode.Uri | undefined {
		const url = appUrl.endsWith('/')
			? appUrl.slice(0, -1) // Remove trailing slash if present
			: appUrl; // Otherwise, use the URL as is

		log.trace(`Getting proxy URI for app URL: ${url}`);
		log.trace(`Known app servers: ${JSON.stringify(Array.from(this._appServers.entries()))}`);

		const appServer = this._appServers.get(url);
		if (appServer) {
			log.trace(`Returning known proxy URI for app URL ${url}: ${appServer.proxyUri.toString(true)}`);
			return appServer.proxyUri;
		}

		log.debug(`No known proxy server URI for app URL ${url}.`);
		return undefined;
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

		progress.report({ message: vscode.l10n.t('Preparing the terminal...') });

		// Save the active document if it's dirty.
		if (document.isDirty) {
			await document.save();
		}

		// Get the preferred runtime for the document's language.
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

		// Create a promise that resolves when shell integration is ready for the terminal,
		// or after a timeout.
		const shellIntegrationPromise: Promise<vscode.TerminalShellIntegration | undefined> = isShellIntegrationEnabledAndSupported ?
			new Promise<vscode.TerminalShellIntegration>((resolve) => {
				// onDidChangeTerminalShellIntegration
				const shellIntegrationDisposable = vscode.window.onDidChangeTerminalShellIntegration(async (e) => {
					if (e.terminal === terminal) {
						shellIntegrationDisposable.dispose();
						resolve(e.shellIntegration);
					}
				});
				this._runApplicationDisposableByName.set(options.name, shellIntegrationDisposable);

				// onDidEndTerminalShellExecution
				const shellExecutionDisposable = vscode.window.onDidEndTerminalShellExecution(async (e) => {
					if (e.terminal === terminal) {
						this.removeAppServer(await terminal.processId);
						shellExecutionDisposable.dispose();
					}
				});
				this._runApplicationDisposableByName.set(options.name, shellExecutionDisposable);

				// onDidCloseTerminal
				const closedTerminalDisposable = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
					if (closedTerminal === terminal) {
						this.removeAppServer(await closedTerminal.processId);
						shellIntegrationDisposable.dispose();
						shellExecutionDisposable.dispose();
						closedTerminalDisposable.dispose();
					}
				});
				this._runApplicationDisposableByName.set(options.name, closedTerminalDisposable);
			}) :
			// If shell integration is disabled or unsupported, resolve immediately.
			// This is to avoid waiting a few seconds before _every_ application run
			// in unsupported shells.
			Promise.resolve(undefined);

		// Reveal the new terminal.
		terminal.show(true);

		// Wait for existing terminals to close, or a timeout.
		await raceTimeout(
			Promise.allSettled(existingTerminals.map((terminal) => {
				// Create a promise that resolves when the terminal is closed.
				// Note that the application process may still be running once this promise resolves.
				const terminalDidClose = new Promise<void>((resolve) => {
					const disposable = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
						if (closedTerminal === terminal) {
							this.removeAppServer(await closedTerminal.processId);
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

		const shellIntegration = await raceTimeout(
			shellIntegrationPromise,
			SHELL_INTEGRATION_TIMEOUT,
			() => log.warn('Timed out waiting for shell integration to be ready'),
		);

		progress.report({ message: vscode.l10n.t('Starting application...') });

		if (shellIntegration) {
			log.info('Shell integration is supported. Executing command with shell integration.');

			// Remember that shell integration is supported.
			await this.setShellIntegrationSupported(true);

			// Execute the command.
			const execution = shellIntegration.executeCommand(terminalOptions.commandLine);

			// Wait for the server URL in the execution output.
			const previewOptions: AppPreviewOptions = {
				terminalPid: await terminal.processId,
				proxyInfo,
				urlPath: options.urlPath,
				appReadyMessage: options.appReadyMessage,
				appUrlStrings: options.appUrlStrings,
			};
			await this.previewUrlInExecutionOutput(execution, previewOptions);
		} else {
			log.info('Shell integration not supported. Executing command without shell integration.');

			// TODO: If a port was provided, we could poll the server until it responds,
			//       then open the URL in the viewer pane.

			// Execute the command without shell integration.
			terminal.sendText(terminalOptions.commandLine, true);

			// Remember that shell integration is not supported to display the guide in future runs.
			await this.setShellIntegrationSupported(false);

			// Guide the user to use a supported shell.
			showShellIntegrationNotSupportedMessage().catch(() => { });
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
		progress.report({ message: vscode.l10n.t('Preparing debug session...') });
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
									terminalPid: processId,
									proxyInfo,
									urlPath: options.urlPath,
									appReadyMessage: options.appReadyMessage,
									appUrlStrings: options.appUrlStrings,
								};
								const didPreviewUrl = await this.previewUrlInExecutionOutput(e.execution, previewOptions);
								if (didPreviewUrl) {
									resolve(didPreviewUrl);
								}
							}
						});
					}
				});
				this._debugApplicationDisposableByName.set(options.name, disposable);
			}),
			DID_PREVIEW_URL_TIMEOUT,
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
					JSON.stringify(error)
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

	private async previewUrlInExecutionOutput(execution: vscode.TerminalShellExecution, options: AppPreviewOptions) {
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
			TERMINAL_OUTPUT_TIMEOUT,
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
			const applyWebPatch = IS_POSITRON_WEB && !IS_RUNNING_ON_PWB;
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

		// Record the known app server URL to proxy server mapping.
		this.addAppServer(
			localBaseUri.toString(),
			options.terminalPid,
			previewUri,
		);
		// Preview the app in the Viewer.
		if (options.terminalPid !== undefined) {
			positron.window.previewUrl(previewUri, {
				type: positron.PreviewSourceType.Terminal,
				id: String(options.terminalPid)
			});
		} else {
			positron.window.previewUrl(previewUri);
		}

		return true;
	}

	private addAppServer(appUrl: string, terminalPid: number | undefined, proxyUri: vscode.Uri): void {
		const url = appUrl.endsWith('/')
			? appUrl.slice(0, -1) // Remove trailing slash if present
			: appUrl; // Otherwise, use the URL as is
		log.trace(`Adding known app server: ${url} with terminal PID ${terminalPid} and proxy URI ${proxyUri.toString()}`);
		this._appServers.set(url, { terminalPid, proxyUri });
		log.trace(`Known app servers: ${JSON.stringify(Array.from(this._appServers.entries()))}`);
	}

	private removeAppServer(terminalPid: number | undefined): void {
		log.trace(`Removing app server for terminal process ID: ${terminalPid}`);
		const serversToRemove: string[] = [];
		this._appServers.forEach((value, key) => {
			if (value.terminalPid === terminalPid) {
				serversToRemove.push(key);
			}
		});
		log.trace(`Found app servers to remove: ${JSON.stringify(serversToRemove)}`);
		serversToRemove.forEach(key => this._appServers.delete(key));
		log.trace(`Known app servers: ${JSON.stringify(Array.from(this._appServers.entries()))}`);
	}
}
