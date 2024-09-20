/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronRunApp, RunAppOptions } from './positron-run-app';
import { raceTimeout, SequencerByKey } from './utils';

const localUrlRegex = /http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})/;

export const log = vscode.window.createOutputChannel('Positron Run App', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<PositronRunApp> {
	context.subscriptions.push(log);

	return new PositronRunAppApiImpl(context);
}

export class PositronRunAppApiImpl implements PositronRunApp {
	private readonly _runApplicationSequencerByName = new SequencerByKey<string>();

	constructor(private readonly _context: vscode.ExtensionContext) { }

	private isShellIntegrationSupported(): boolean {
		return this._context.globalState.get('shellIntegrationSupported', true);
	}

	setShellIntegrationSupported(supported: boolean): Thenable<void> {
		return this._context.globalState.update('shellIntegrationSupported', supported);
	}

	async runApplication(options: RunAppOptions): Promise<void> {
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
				title: vscode.l10n.t(`Running ${options.name} application`),
			},
				(progress) => this.doRunApplication(document, options, progress),
			)),
		);
	}

	private async doRunApplication(document: vscode.TextDocument, options: RunAppOptions, progress: vscode.Progress<{ message?: string }>): Promise<void> {
		// Save the active document if it's dirty.
		if (document.isDirty) {
			await document.save();
		}

		// Get the preferred runtime for the document's language.
		progress.report({ message: vscode.l10n.t('Getting interpreter information...') });
		let runtime: positron.LanguageRuntimeMetadata;
		try {
			runtime = await positron.runtime.getPreferredRuntime(document.languageId);
		} catch (error) {
			vscode.window.showErrorMessage(
				vscode.l10n.t(
					"Failed to get '{0}' interpreter information: {1}",
					document.languageId,
					error.message
				),
			);
			return;
		}

		// Get the terminal options for the application.
		// TODO: If we're in Posit Workbench find a free port and corresponding URL prefix.
		//       Some application frameworks need to know the URL prefix when running behind a proxy.
		progress.report({ message: vscode.l10n.t('Getting terminal options...') });
		const port = undefined;
		const urlPrefix = undefined;
		const terminalOptions = await options.getTerminalOptions(runtime, document, port, urlPrefix);
		if (!terminalOptions) {
			return;
		}

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
			() => {
				log.warn('Timed out waiting for existing terminals to close. Proceeding anyway');
			}
		);

		// Replace the contents of the viewer pane with a blank page while the app is loading.
		positron.window.previewUrl(vscode.Uri.parse('about:blank'));

		const shellIntegrationConfig = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration');
		const runAppConfig = vscode.workspace.getConfiguration('positron.runApplication');

		let shellIntegration: vscode.TerminalShellIntegration | undefined;
		if (shellIntegrationConfig.get('enabled')) {
			// Shell integration may have already been injected into the terminal.
			shellIntegration = terminal.shellIntegration;

			// If it hasn't yet been injected...
			if (!shellIntegration) {
				if (this.isShellIntegrationSupported()) {
					// Shell integration was detected as supported in a previous run.
					// Wait for it to be injected, or a timeout.
					progress.report({ message: vscode.l10n.t('Activating terminal shell integration...') });

					shellIntegration = await raceTimeout(
						// Create a promise that resolves with the terminal's shell integration once it's injected.
						new Promise<vscode.TerminalShellIntegration>((resolve) => {
							const disposable = vscode.window.onDidChangeTerminalShellIntegration(async (e) => {
								if (e.terminal === terminal) {
									disposable.dispose();
									resolve(e.shellIntegration);

									// Remember that shell integration is supported in this terminal.
									await this.setShellIntegrationSupported(true);
								}
							});
						}), 5000, () => {
							log.warn('Timed out waiting for terminal shell integration. Proceeding without shell integration');

							// Remember that shell integration is not supported in this terminal,
							// so that we don't wait for it to be injected next time.
							this.setShellIntegrationSupported(false);

							// Show the shell integration not supported message, if enabled.
							if (runAppConfig.get('showShellIntegrationNotSupportedMessage')) {
								showShellIntegrationNotSupportedMessage()
									.catch(error => log.error(`Error showing shell integration not supported message: ${error}`));
							}
						});
				} else {
					// Shell integration was detected as not supported in a previous run.
					log.warn('Shell integration is not supported in this terminal');
					if (runAppConfig.get('showShellIntegrationNotSupportedMessage')) {
						showShellIntegrationNotSupportedMessage()
							.catch(error => log.error(`Error showing shell integration not supported message: ${error}`));
					}
				}
			}
		} else if (runAppConfig.get('showEnableShellIntegrationMessage')) {
			// Shell integration is disabled. Proceed without it, but give the user the option to
			// enable it and to rerun the application.
			showEnableShellIntegrationMessage()
				.catch(error => {
					log.error(`Error during shell integration prompt: ${error}`);
					return { rerunApplication: false };
				})
				.then(({ rerunApplication }) => {
					if (rerunApplication) {
						this.queueRunApplication(document, options);
					}
				});
		}


		if (shellIntegration) {
			progress.report({ message: vscode.l10n.t('Starting application server...') });
			const execution = shellIntegration.executeCommand(terminalOptions.commandLine);

			// Wait for the server URL to appear in the terminal output, or a timeout.
			const stream = execution.read();
			const url = await raceTimeout(
				(async () => {
					for await (const data of stream) {
						const match = data.match(localUrlRegex)?.[0];
						if (match) {
							return new URL(match);
						}
					}
					log.warn('URL not found in terminal output');
					return undefined;
				})(),
				5000,
				() => {
					log.warn('Timed out waiting for server URL in terminal output');
				}
			);

			if (url) {
				// Convert the url to an external URI.
				const localBaseUri = vscode.Uri.parse(url.toString());
				const localUri = options.urlPath ?
					vscode.Uri.joinPath(localBaseUri, options.urlPath) : localBaseUri;
				const externalUri = await vscode.env.asExternalUri(localUri);

				// Open the server URL in the viewer pane.
				positron.window.previewUrl(externalUri);
			}
		} else {
			// No shell integration support, just run the command.
			terminal.sendText(terminalOptions.commandLine);

			// TODO: If a port was provided, we could poll the server until it responds,
			//       then open the URL in the viewer pane.
		}
	}
}

interface IShellIntegrationPromptResult {
	rerunApplication: boolean;
}

async function showEnableShellIntegrationMessage(): Promise<IShellIntegrationPromptResult> {
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
		return { rerunApplication: selection === rerunApplication };
	} else if (selection === dontAskAgain) {
		// Disable the prompt for future runs.
		const runAppConfig = vscode.workspace.getConfiguration('positron.runApplication');
		await runAppConfig.update('showShellIntegrationPrompt', false, vscode.ConfigurationTarget.Global);
	}

	return { rerunApplication: false };
}

async function showShellIntegrationNotSupportedMessage(): Promise<void> {
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
