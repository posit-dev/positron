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

	return new PositronRunAppApiImpl();
}

class PositronRunAppApiImpl implements PositronRunApp {
	private _runApplicationSequencerByName = new SequencerByKey<string>();

	async runApplication(options: RunAppOptions): Promise<void> {
		return this._runApplicationSequencerByName.queue(
			options.name,
			() => this.doRunApplication(options)
		);
	}

	async doRunApplication(options: RunAppOptions): Promise<void> {
		// If there's no active text editor, do nothing.
		const document = vscode.window.activeTextEditor?.document;
		if (!document) {
			return;
		}

		// Save the active document if it's dirty.
		if (document.isDirty) {
			await document.save();
		}

		// Get the preferred runtime for the document's language.
		const runtime = await positron.runtime.getPreferredRuntime(document.languageId);

		// Get the terminal options for the application.
		// TODO: If we're in Posit Workbench find a free port and corresponding URL prefix.
		//       Some application frameworks need to know the URL prefix when running behind a proxy.
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

		// Show a prompt to enable shell integration, if necessary.
		// If shell integration is disabled, proceed without it but give the user the option to
		// enable it and rerun the application.
		maybeShowShellIntegrationPrompt()
			.then((result) => {
				// TODO: Rename to didEnableShellIntegration?
				if (result.rerunApplication) {
					this.runApplication(options);
				}
			});

		const runAppConfig = vscode.workspace.getConfiguration('positron.runApplication');

		const shellIntegrationPromise = new Promise<vscode.TerminalShellIntegration>((resolve) => {
			const disposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
				if (e.terminal === terminal) {
					disposable.dispose();
					resolve(e.shellIntegration);
				}
			});
		});

		// If shell integration isn't injected in 1 second, show the shell integration not supported message.
		// If it is, let the user know that it's now supported and ask if they want to rerun the application.
		(async () => {
			const shellIntegration = await raceTimeout(shellIntegrationPromise, 1000, () => {
				showShellIntegrationNotSupportedMessage();
			});
			// TODO: Rather use a global memento for useShellIntegration?
			if (shellIntegration && !runAppConfig.get('useShellIntegration')) {
				await runAppConfig.update('useShellIntegration', true, vscode.ConfigurationTarget.Global);

				const rerunApplication = vscode.l10n.t('Rerun Application');
				const selection = await vscode.window.showInformationMessage(
					vscode.l10n.t('Shell integration is now supported in this terminal. Would you like to rerun the application with shell integration?'),
					rerunApplication,
				);
				if (selection === rerunApplication) {
					this.runApplication(options);
				}
			}
		})();

		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t(`Running ${options.name} application`),
		}, async (progress) => {

			let shellIntegration: vscode.TerminalShellIntegration | undefined;
			const shellIntegrationConfig = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration');
			if (shellIntegrationConfig.get('enabled')) {
				// Shell integration may have already been injected into the terminal.
				shellIntegration = terminal.shellIntegration;
				// If shell integration has not yet been injected, wait for it, or a timeout.
				if (!shellIntegration) {
					if (runAppConfig.get('useShellIntegration')) {
						progress.report({ message: vscode.l10n.t('Activating terminal shell integration...') });
						shellIntegration = await raceTimeout(shellIntegrationPromise, 5000, async () => {
							log.warn('Timed out waiting for terminal shell integration. Proceeding without shell integration');
							await runAppConfig.update('useShellIntegration', false, vscode.ConfigurationTarget.Global);
							showShellIntegrationNotSupportedMessage();
						});
					}
				}
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
		});
	}
}

interface IShellIntegrationPromptResult {
	rerunApplication: boolean;
}

async function maybeShowShellIntegrationPrompt(): Promise<IShellIntegrationPromptResult> {
	// Don't show the prompt if shell integration is already enabled.
	const shellIntegrationConfig = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration');
	if (shellIntegrationConfig.get('enabled')) {
		return { rerunApplication: false };
	}

	// Don't show the prompt if the user has disabled it.
	const runAppConfig = vscode.workspace.getConfiguration('positron.runApplication');
	if (runAppConfig.get('showShellIntegrationPrompt') === false) {
		return { rerunApplication: false };
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
		await runAppConfig.update('showShellIntegrationPrompt', false, vscode.ConfigurationTarget.Global);
	}

	return { rerunApplication: false };
}

async function showShellIntegrationNotSupportedMessage(): Promise<void> {
	const learnMore = vscode.l10n.t('Learn More');
	const selection = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			'Shell integration isn\'t supported in this terminal, ' +
			'so automatic preview in the Viewer pane isn\'t available. ' +
			'To use this feature, please switch to a terminal that supports shell integration.'
		),
		learnMore,
	);
	if (selection === learnMore) {
		await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/terminal/shell-integration'));
	}
}
