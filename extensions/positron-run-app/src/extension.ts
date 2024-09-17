/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronRunApp, RunAppOptions } from './positron-run-app';
import { raceTimeout } from './utils';

const localUrlRegex = /http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})/;

export const log = vscode.window.createOutputChannel('Positron Run App', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<PositronRunApp> {
	context.subscriptions.push(log);

	return new PositronRunAppApiImpl();
}

class PositronRunAppApiImpl implements PositronRunApp {
	async runApplication(options: RunAppOptions): Promise<void> {
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
		// We'll await the promise after first starting the application with or without shell integration.
		const shellIntegrationPromptResultPromise = maybeShowShellIntegrationPrompt();

		let shellIntegration: vscode.TerminalShellIntegration | undefined;
		const shellIntegrationConfig = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration');
		if (shellIntegrationConfig.get('enabled')) {
			// Shell integration may have already been injected into the terminal.
			shellIntegration = terminal.shellIntegration;

			// If shell integration has not yet been injected, wait for it, or a timeout.
			if (!shellIntegration) {
				shellIntegration = await raceTimeout(
					new Promise<vscode.TerminalShellIntegration>(resolve => {
						const disposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
							if (e.terminal === terminal) {
								disposable.dispose();
								resolve(e.shellIntegration);
							}
						});
					}),
					// TODO: Currently, this will wait 5 seconds *every* time we run an app in a terminal
					//       that doesn't have shell integration. We should consider caching the result.
					5000,
					() => {
						log.warn('Timed out waiting for terminal shell integration. Proceeding without shell integration');
					});
			}
		}

		if (shellIntegration) {
			const execution = shellIntegration.executeCommand(terminalOptions.commandLine);

			// Wait for the server URL to appear in the terminal output, or a timeout.
			const stream = execution.read();
			const url = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t(`Starting ${options.name} server...`),
				},
				() => raceTimeout(
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
				));

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

		const shellIntegrationPromptResult = await shellIntegrationPromptResultPromise;
		if (shellIntegrationPromptResult.rerunApplication) {
			await this.runApplication(options);
		}
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
