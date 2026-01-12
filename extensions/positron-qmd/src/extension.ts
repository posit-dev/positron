/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ExtensionEnablement } from './util/extensionEnablement.js';
import { DisposableStore } from './util/disposable.js';
import { QmdParserService } from './parserService.js';

/** Extension log output channel */
export let log: vscode.LogOutputChannel;

export async function activate(
	context: vscode.ExtensionContext
): Promise<void> {
	// Create extension log output channel
	log = vscode.window.createOutputChannel('Positron QMD', { log: true });
	context.subscriptions.push(log);

	// Manage extension enablement based on enablement setting
	context.subscriptions.push(
		new ExtensionEnablement(
			'notebook.plainText',
			'enable',
			() => {
				// Actually activate extension features
				const disposables = new DisposableStore();
				disposables.add(new QmdParserService(context.extensionUri, log));
				return disposables;
			},
			log,
		)
	);

	log.info('Extension loaded!');
}
