/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ExtensionEnablement } from './util/extensionEnablement.js';
import { DisposableStore } from './util/disposable.js';
import { QmdParserService } from './parserService.js';
import { QmdNotebookSerializer } from './notebookSerializer.js';

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
			'positron.notebook.plainText',
			'enable',
			() => {
				// Actually activate extension features
				const disposables = new DisposableStore();

				const parserService = disposables.add(new QmdParserService(context.extensionUri, log));

				// Register notebook serializer
				const serializer = new QmdNotebookSerializer(parserService.parser, log);
				disposables.add(vscode.workspace.registerNotebookSerializer(
					'quarto-notebook',
					serializer,
					{
						transientOutputs: true, // Outputs not persisted to .qmd
						transientCellMetadata: {
							breakpointMargin: true,
							id: true,
						}
					}
				));

				return disposables;
			},
			log,
		)
	);

	log.info('Extension loaded!');
}
