/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronRunAppApi, RunAppOptions } from './positron-run-app';
import { raceTimeout } from './utils';

const localUrlRegex = /http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})/;

export const log = vscode.window.createOutputChannel('Positron App Runners', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<PositronRunAppApi> {
	context.subscriptions.push(log);

	return new PositronRunAppApiImpl();
}

class PositronRunAppApiImpl implements PositronRunAppApi {
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

		// Get existing terminals with the application's name.
		const existingTerminals = vscode.window.terminals.filter((t) => t.name === options.label);

		// Create a new terminal for the application.
		const terminal = vscode.window.createTerminal({
			name: options.label,
			env: options.env,
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

		// Wait for shell integration to be available, or a timeout.
		let shellIntegration = terminal.shellIntegration;
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
				1000,
				() => {
					log.warn('Timed out waiting for terminal shell integration. Proceeding without shell integration');
				});
		}

		if (shellIntegration) {
			const execution = shellIntegration.executeCommand(options.commandLine);

			// Wait for the server URL to appear in the terminal output, or a timeout.
			const stream = execution.read();
			const url = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t(`Starting ${options.label} server...`),
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
			terminal.sendText(options.commandLine);
		}
	}
}
