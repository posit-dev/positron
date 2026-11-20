/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { EngineHost } from './engineHost';
import type { API, GitExtension } from './gitApi';

/**
 * Registers the checkpoints engine for the first workspace folder with Positron (spec 5.1), once
 * the git extension's API is ready. Does nothing without a workspace folder, without the git
 * extension, or in a Positron that has no `positron.checkpoints` API.
 */
export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('Checkpoints', { log: true });
	context.subscriptions.push(log);
	start(context, log).catch(error => {
		log.error(`The checkpoints engine could not start: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	});
}

export function deactivate(): void { }

async function start(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<void> {
	// An older Positron has no checkpoints API.
	if (typeof positron.checkpoints?.registerEngine !== 'function') {
		log.info('This version of Positron has no checkpoints API; no engine is registered.');
		return;
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder === undefined) {
		log.info('No folder is open; no engine is registered.');
		return;
	}
	const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (gitExtension === undefined) {
		log.warn('The git extension is not installed; no engine is registered.');
		return;
	}
	const exports = await gitExtension.activate();
	if (!exports.enabled) {
		log.warn('The git extension is disabled; no engine is registered.');
		return;
	}
	const api = exports.getAPI(1);
	await initialized(api, context);
	await new EngineHost(context, folder, api, log).start();
}

/** Resolves once the git extension's API has found git and the open repositories. */
function initialized(api: API, context: vscode.ExtensionContext): Promise<void> {
	if (api.state === 'initialized') {
		return Promise.resolve();
	}
	return new Promise(resolve => {
		const listener = api.onDidChangeState(state => {
			if (state === 'initialized') {
				listener.dispose();
				resolve();
			}
		});
		context.subscriptions.push(listener);
	});
}
