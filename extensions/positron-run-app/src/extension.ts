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
		console.log(`Running ${options.label} App...`);

		const document = vscode.window.activeTextEditor?.document;
		if (!document) {
			return;
		}

		if (document.isDirty) {
			await document.save();
		}

		const oldTerminals = vscode.window.terminals.filter((t) => t.name === options.label);

		const runtime = await positron.runtime.getPreferredRuntime(options.languageId);

		const commandOptions = await options.getRunCommand(runtime.runtimePath, document);
		if (!commandOptions) {
			return;
		}

		const terminal = vscode.window.createTerminal({
			name: options.label,
			env: commandOptions.env,
		});
		terminal.show(true);

		const closingTerminals = oldTerminals.map((x) => {
			const p = new Promise<void>((resolve) => {
				// Resolve when the terminal is closed. We're working hard to be accurate
				// BUT empirically it doesn't seem like the old Shiny processes are
				// actually terminated at the time this promise is resolved, so callers
				// shouldn't assume that.
				const subscription = vscode.window.onDidCloseTerminal((term) => {
					if (term === x) {
						subscription.dispose();
						resolve();
					}
				});
			});
			x.dispose();
			return p;
		});
		await Promise.allSettled(closingTerminals);

		positron.window.previewUrl(vscode.Uri.parse('about:blank'));

		const shellIntegration = await new Promise<vscode.TerminalShellIntegration>(resolve => {
			const disposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
				if (e.terminal === terminal) {
					disposable.dispose();
					resolve(e.shellIntegration);
				}
			});
		});
		// TODO: Escape the command for the terminal.
		// const cmdline = escapeCommandForTerminal(terminal, python, args);
		console.log('Command:', commandOptions.command);
		const execution = shellIntegration.executeCommand(commandOptions.command);

		// Wait for the server URL to appear in the terminal output, or a timeout.
		const stream = execution.read();
		const url = await raceTimeout(waitForUrl(stream), 5000);
		if (!url) {
			throw new Error('Timed out waiting for server URL in terminal output');
		}

		const localBaseUri = vscode.Uri.parse(url.toString());
		const localUri = commandOptions.path ?
			vscode.Uri.joinPath(localBaseUri, commandOptions.path) : localBaseUri;
		const externalUri = await vscode.env.asExternalUri(localUri);
		positron.window.previewUrl(externalUri);
	}
}

async function waitForUrl(stream: AsyncIterable<string>): Promise<URL> {
	for await (const data of stream) {
		log.debug(`Data: ${data}`);
		const match = data.match(localUrlRegex)?.[0];
		log.debug(`Match: ${Boolean(match)}`);
		if (match) {
			try {
				return new URL(match);
			} catch (e) {
				log.debug(`Ignoring invalid URL: ${data}`);
				// Not a valid URL
			}
		}
	}
	throw new Error('No URL found in stream');
}
