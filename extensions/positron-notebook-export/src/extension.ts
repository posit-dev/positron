/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PythonPercentNotebookExporter, RPercentNotebookExporter } from './percentNotebookExporter.js';
import { NotebookExportExtensionImpl } from './api.js';
import { NotebookExportExtension } from './positron-notebook-export.js';
import { NotebookExportCommand } from './notebookExportCommand.js';

export function activate(context: vscode.ExtensionContext): NotebookExportExtension {
	const log = vscode.window.createOutputChannel('Notebook Export', { log: true });
	context.subscriptions.push(log);
	log.info('Activating extension...');

	const api = new NotebookExportExtensionImpl();
	context.subscriptions.push(new NotebookExportCommand(api, log));

	// Register builtin percent script exporters for Python and R.
	context.subscriptions.push(api.registerNotebookExporter(new PythonPercentNotebookExporter()));
	context.subscriptions.push(api.registerNotebookExporter(new RPercentNotebookExporter()));

	log.info('Activated!');
	return api;
}
