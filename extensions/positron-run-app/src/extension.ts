/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronRunAppApi, RunAppOptions } from './positron-run-app';
import { findFreePort, randomPort, waitForPortConnection } from './ports';

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

		// TODO: Check for a port setting?
		// TODO: Cache used port?
		const port = await findFreePort(randomPort(), 10, 3000);

		const oldTerminals = vscode.window.terminals.filter((t) => t.name === options.label);

		const runtime = await positron.runtime.getPreferredRuntime(options.languageId);

		const commandOptions = await options.getRunCommand(runtime.runtimePath, document, port);
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

		// TODO: Escape the command for the terminal.
		// const cmdline = escapeCommandForTerminal(terminal, python, args);
		console.log('Command:', commandOptions.command);
		terminal.sendText(commandOptions.command);

		positron.window.previewUrl(vscode.Uri.parse('about:blank'));

		// TODO: Handle being in workbench.
		const localUri = vscode.Uri.parse(commandOptions.url ?? `http://localhost:${port}`);
		let uri: vscode.Uri;
		try {
			uri = await vscode.env.asExternalUri(localUri);
		} catch (error) {
			uri = localUri;
		}

		await waitForPortConnection(port, 10_000);

		positron.window.previewUrl(uri);
	}
}
