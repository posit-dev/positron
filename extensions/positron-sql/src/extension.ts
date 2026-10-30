/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CONFIGURATION_SECTION, ENABLED_SETTING, SqlSession } from './session';

/**
 * Activation only watches `sql.enabled`. Everything else -- the output channel, the providers,
 * the analyzer -- is created when it is turned on and torn down when it is turned off, so with
 * the setting off the extension loads nothing. No reload is needed either way.
 */
export function activate(context: vscode.ExtensionContext): void {
	let log: vscode.LogOutputChannel | undefined;
	let session: SqlSession | undefined;

	const update = () => {
		const enabled = vscode.workspace.getConfiguration(CONFIGURATION_SECTION)
			.get<boolean>(ENABLED_SETTING) === true;
		if (enabled && !session) {
			if (!log) {
				log = vscode.window.createOutputChannel('SQL', { log: true });
				context.subscriptions.push(log);
			}
			session = new SqlSession(context, log);
			session.start();
		} else if (!enabled && session) {
			session.dispose();
			session = undefined;
		}
	};

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.${ENABLED_SETTING}`)) {
				update();
			}
		}),
		{ dispose: () => session?.dispose() },
	);
	update();
}

export function deactivate(): void { }

