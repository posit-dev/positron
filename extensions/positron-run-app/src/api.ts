/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugAdapterTrackerFactory } from './debugAdapterTrackerFactory';
import { log } from './extension';
import { DebugAppOptions, PositronRunApp, RunAppOptions, RunConsoleAppOptions } from './positron-run-app';
import { AppUrlDetector } from './appUrlDetector';
import { raceTimeout, SequencerByKey } from './utils';
import { DAP_CONFIGURATION_TIMEOUT, DID_PREVIEW_URL_TIMEOUT, IS_POSITRON_WEB, IS_RUNNING_ON_PWB, SHELL_INTEGRATION_TIMEOUT, TERMINAL_OUTPUT_TIMEOUT } from './constants.js';
import { AppPreviewOptions, Config, PositronProxyInfo } from './types.js';
import { shouldUsePositronProxy, showShellIntegrationNotSupportedMessage, showEnableShellIntegrationMessage } from './api-utils.js';


export class PositronRunAppApiImpl implements PositronRunApp, vscode.Disposable {
	private static readonly CONSOLE_SESSIONS_KEY = 'consoleSessionsByName';

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
		try {
			const document = this.getDocumentForRun(options.name);
			if (!document) {
				return;
			}
			await this.queueRunApplication(options.name, (progress) => this.doRunApplication(document, options, progress));
		} catch (error) {
			this.showRunError(options.name, error);
		}
	}

	public async runApplicationInConsole(options: RunConsoleAppOptions): Promise<void> {
		try {
			const document = this.getDocumentForRun(options.name);
			if (!document) {
				return;
			}
			await this.queueRunApplication(options.name, (progress) => this.doRunApplicationInConsole(document, options, progress));
		} catch (error) {
			this.showRunError(options.name, error);
		}
	}

	private getDocumentForRun(appName: string): vscode.TextDocument | undefined {
		const document = vscode.window.activeTextEditor?.document;
		if (!document) {
			return undefined;
		}

		if (this._runApplicationSequencerByName.has(appName)) {
			vscode.window.showErrorMessage(vscode.l10n.t('{0} application is already starting.', appName));
			return undefined;
		}

		return document;
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

	private queueRunApplication(
		name: string,
		task: (progress: vscode.Progress<{ message?: string }>) => Promise<void>,
	): Promise<void> {
		return this._runApplicationSequencerByName.queue(
			name,
			async () => vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Running {0} application', name),
			}, task),
		);
	}

	private async doRunApplication(document: vscode.TextDocument, options: RunAppOptions, progress: vscode.Progress<{ message?: string }>): Promise<void> {
		progress.report({ message: vscode.l10n.t('Preparing the terminal...') });

		const { runtime, urlPrefix, proxyInfo } = await this.prepareRunApplication(document, options);

		// Get the terminal options for the application.
		const terminalOptions = await options.getTerminalOptions(runtime, document, urlPrefix);
		if (!terminalOptions) {
			return;
		}

		// Show shell integration prompts and check if shell integration is:
		// - enabled in the workspace, and
		// - supported in the terminal.
		const isShellIntegrationEnabledAndSupported = this.showShellIntegrationMessages(
			() => this.queueRunApplication(options.name, (progress) => this.doRunApplication(document, options, progress))
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



	private async doRunApplicationInConsole(
		document: vscode.TextDocument,
		options: RunConsoleAppOptions,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<void> {
		progress.report({ message: vscode.l10n.t('Preparing the console...') });

		const { runtime, urlPrefix, proxyInfo } = await this.prepareRunApplication(document, options);

		// Get the console code for the application.
		const consoleCode = await options.getConsoleCode(runtime, document, urlPrefix);
		if (!consoleCode) {
			return;
		}

		const cleanup: vscode.Disposable[] = [];
		try {

			// When breakpoints are set and app runner requests debugger
			// synchronization, listen for DAP `configurationDone` before starting or
			// restarting the runtime so we don't miss the event. This ensures
			// breakpoints are installed in the backend before we execute the app code
			// (Ark needs to know about breakpoints to inject them while sourcing app
			// files, e.g. in Shiny). Both start and restart trigger a DAP
			// reconnection.
			//
			// Known issues:
			// - I noticed that Ark seems to be ready before the configuration listener
			//   fires, so we probably could optimise startup time when breakpoints are
			//   set, but likely not in a trivial way.
			// - The synchronization structure is not great. We're waiting for any
			//   debug adapter whose session type matches the one we're tracking.
			//   There could be races when user switches session after starting a
			//   Shiny app. We'd ideally be more targeted regarding which DAP we're
			//   waiting on.
			const shouldSyncDebugger =
				options.debugAdapterType &&
				vscode.debug.breakpoints.length > 0;
			let configurationDone: Promise<void> | undefined;

			if (shouldSyncDebugger) {
				configurationDone = new Promise<void>(resolve => {
					const listener = this._debugAdapterTrackerFactory.onDidCompleteConfiguration((session) => {
						if (session.type !== options.debugAdapterType) {
							return;
						}
						listener.dispose();
						resolve();
					});
					cleanup.push(listener);
				});
			}

			// Look up a previously used console session for this app and
			// check if it's still alive. If so, restart it; otherwise
			// create a fresh one.
			let sessionId = await this.findConsoleSession(options.name);

			if (sessionId) {
				progress.report({ message: vscode.l10n.t('Restarting application...') });

				try {
					const didRestart = await positron.runtime.restartSession(sessionId);
					if (!didRestart) {
						log.debug('Session restart was cancelled');
						return;
					}
				} catch (error) {
					log.debug(`Could not restart session for ${options.name}, creating a new one: ${error}`);
					sessionId = undefined;
				}
			}

			if (!sessionId) {
				progress.report({ message: vscode.l10n.t('Starting console session...') });

				const session = await positron.runtime.startLanguageRuntime(
					runtime.runtimeId,
					options.name,
				);

				sessionId = session.metadata.sessionId;
			}

			this.saveConsoleSession(options.name, sessionId);

			if (configurationDone) {
				progress.report({ message: vscode.l10n.t('Waiting for debugger initialization...') });
				await raceTimeout(
					configurationDone,
					DAP_CONFIGURATION_TIMEOUT,
					() => log.warn('Timed out waiting for DAP configurationDone; proceeding without breakpoints'),
				);
			}

			positron.runtime.focusSession(sessionId);
			progress.report({ message: vscode.l10n.t('Starting application...') });

			// Set up URL detection via an observer for the output of our execute request
			const detector = new AppUrlDetector(options.appUrlStrings, options.appReadyMessage);
			const cancellation = new vscode.CancellationTokenSource();
			cleanup.push(cancellation);

			const observer: positron.runtime.ExecutionObserver = {
				token: cancellation.token,
				onOutput: (data) => detector.processOutput(data),
				onError: (data) => detector.processOutput(data),
			};

			// Execute the code in the console session.
			// Don't await: the Thenable resolves only when the app stops.
			positron.runtime.executeCode(
				document.languageId,
				consoleCode.code,
				true,
				false,
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Continue,
				observer,
				sessionId,
			).then(undefined, (error: Error) => {
				log.error(`Console execution error: ${error.message}`);
			});

			const url = await raceTimeout(
				detector.found,
				TERMINAL_OUTPUT_TIMEOUT,
				() => {
					cancellation.cancel();
					throw new Error(vscode.l10n.t('Timed out waiting for {0} app URL in console output.', options.name));
				},
			);

			await this.previewApp(url!, {
				proxyInfo,
				urlPath: options.urlPath,
				previewSource: {
					type: positron.PreviewSourceType.Runtime,
					id: sessionId,
				},
			});
		} finally {
			cleanup.forEach(d => d.dispose());
		}
	}

	public async debugApplication(options: DebugAppOptions): Promise<void> {
		try {
			// If there's no active text editor, do nothing.
			const document = vscode.window.activeTextEditor?.document;
			if (!document) {
				return;
			}

			if (this._debugApplicationSequencerByName.has(options.name)) {
				vscode.window.showErrorMessage(vscode.l10n.t('{0} application is already starting.', options.name));
				return;
			}

			await this.queueDebugApplication(document, options);
		} catch (error) {
			this.showRunError(options.name, error);
		}
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

		// Set up the proxy server for the application if applicable.
		let urlPrefix: string | undefined;
		let proxyInfo: PositronProxyInfo | undefined;
		if (shouldUsePositronProxy(options.name)) {
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

	private async prepareRunApplication(
		document: vscode.TextDocument,
		options: { name: string },
	): Promise<{
		runtime: positron.LanguageRuntimeMetadata;
		urlPrefix: string | undefined;
		proxyInfo: PositronProxyInfo | undefined;
	}> {
		this._runApplicationDisposableByName.get(options.name)?.dispose();
		this._runApplicationDisposableByName.delete(options.name);

		if (document.isDirty) {
			await document.save();
		}

		const runtime = await this.getPreferredRuntime(document.languageId);

		let urlPrefix = undefined;
		let proxyInfo: PositronProxyInfo | undefined;
		if (shouldUsePositronProxy(options.name)) {
			proxyInfo = await vscode.commands.executeCommand<PositronProxyInfo>('positronProxy.startPendingProxyServer');
			log.debug(`Proxy started for app at proxy path ${proxyInfo.proxyPath} with uri ${proxyInfo.externalUri.toString()}`);
			urlPrefix = proxyInfo.proxyPath;
		}

		return { runtime, urlPrefix, proxyInfo };
	}

	private async getPreferredRuntime(languageId: string): Promise<positron.LanguageRuntimeMetadata> {
		const runtime = await positron.runtime.getPreferredRuntime(languageId);
		if (!runtime) {
			throw new Error(vscode.l10n.t("No '{0}' interpreter found.", languageId));
		}
		return runtime;
	}

	// This persists known sessions so we restart apps in the right console
	// session after an extension host restart or a window reload
	private saveConsoleSession(name: string, sessionId: string): Thenable<void> {
		const persisted = this._globalState.get<Record<string, string>>(
			PositronRunAppApiImpl.CONSOLE_SESSIONS_KEY, {}
		);
		persisted[name] = sessionId;
		return this._globalState.update(PositronRunAppApiImpl.CONSOLE_SESSIONS_KEY, persisted);
	}

	private async findConsoleSession(name: string): Promise<string | undefined> {
		const persisted = this._globalState.get<Record<string, string>>(
			PositronRunAppApiImpl.CONSOLE_SESSIONS_KEY, {}
		);

		// Prune all stale sessions so the persisted map doesn't grow over time
		let pruned = false;
		for (const [key, id] of Object.entries(persisted)) {
			const session = await positron.runtime.getSession(id);
			if (!session) {
				delete persisted[key];
				pruned = true;
			}
		}
		if (pruned) {
			await this._globalState.update(PositronRunAppApiImpl.CONSOLE_SESSIONS_KEY, persisted);
		}

		return persisted[name];
	}

	private showRunError(appName: string, error: unknown): void {
		if (error instanceof Error) {
			vscode.window.showErrorMessage(error.message);
		} else {
			vscode.window.showErrorMessage(vscode.l10n.t('Failed to start {0} application: {1}', appName, String(error)));
		}
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
		const detector = new AppUrlDetector(options.appUrlStrings, options.appReadyMessage);

		// Feed the stream into the detector. The loop breaks once the URL is
		// found, or ends when the terminal process exits.
		(async () => {
			for await (const data of stream) {
				log.trace('Execution:', execution.commandLine.value, data);
				if (detector.processOutput(data)) {
					break;
				}
			}
		})();

		const url = await raceTimeout(
			detector.found,
			TERMINAL_OUTPUT_TIMEOUT,
			() => log.error('Timed out waiting for server output in terminal'),
		);

		if (!url) {
			log.error('Cannot preview URL. App is not ready or URL not found in terminal output.');
			return false;
		}

		return this.previewApp(url, {
			proxyInfo: options.proxyInfo,
			urlPath: options.urlPath,
			terminalPid: options.terminalPid,
			previewSource: options.terminalPid !== undefined
				? { type: positron.PreviewSourceType.Terminal, id: String(options.terminalPid) }
				: undefined,
		});
	}

	private async previewApp(url: URL, options: {
		proxyInfo?: PositronProxyInfo;
		urlPath?: string;
		terminalPid?: number;
		previewSource?: positron.PreviewSource;
	}): Promise<boolean> {
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
		if (options.previewSource) {
			positron.window.previewUrl(previewUri, options.previewSource);
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
