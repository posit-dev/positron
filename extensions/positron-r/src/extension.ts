/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { registerCommands } from './commands';
import { providePackageTasks } from './tasks';
import { setContexts } from './contexts';
import { setupTestExplorer, refreshTestExplorer } from './testing/testing';
import { RRuntimeManager } from './runtime-manager';
import { RSessionManager } from './session-manager';
import { registerUriHandler } from './uri-handler';
import { registerRLanguageModelTools } from './llm-tools.js';
import { registerFileAssociations } from './file-associations.js';
import { PositronSupervisorApi } from './positron-supervisor';
import { registerRFilePasteAndDropProvider } from './languageFeatures/rFilePasteAndDropProvider.js';
import { setupArkJupyterKernel } from './kernel';
import { RDataEditorProvider, RdsEditorProvider } from './rdata-editor.js';

export const LOGGER = vscode.window.createOutputChannel('R Language Pack', { log: true });

// Export the runtime manager so other modules can access discovery state
export let runtimeManager: RRuntimeManager;

export function activate(context: vscode.ExtensionContext) {
	const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
		LOGGER.appendLine(vscode.l10n.t('Log level: {0}', vscode.LogLevel[logLevel]));
	};
	context.subscriptions.push(LOGGER.onDidChangeLogLevel(onDidChangeLogLevel));
	onDidChangeLogLevel(LOGGER.logLevel);

	// Initialize the session manager with the extension context before registering
	// the runtime manager. This ensures that the session manager has access to
	// persistent state (workspaceState) for tracking the last foreground session,
	// which is needed to properly restore the LSP after extension host restarts.
	RSessionManager.initialize(context);

	runtimeManager = new RRuntimeManager(context);
	positron.runtime.registerLanguageRuntimeManager('r', runtimeManager);

	// Set up ark as a Jupyter kernel so external tools like Quarto can find it
	setupArkJupyterKernel(context);

	// Set contexts.
	setContexts(context);

	// Register commands.
	registerCommands(context, runtimeManager);

	// Register LLM tools.
	registerRLanguageModelTools(context);

	// Provide tasks.
	providePackageTasks(context);

	// Register file associations.
	registerFileAssociations();

	// Register custom editors for R data files.
	context.subscriptions.push(RDataEditorProvider.register(context));
	context.subscriptions.push(RdsEditorProvider.register(context));

	// Register R file paste and drop provider.
	registerRFilePasteAndDropProvider(context);

	// Prepare to handle cli-produced hyperlinks that target the positron-r extension.
	registerUriHandler();

	// Setup testthat test explorer.
	setupTestExplorer(context);
	vscode.workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration('positron.r.testing')) {
			refreshTestExplorer(context);
		}
	});
}

export async function supervisorApi(): Promise<PositronSupervisorApi> {
	const ext = vscode.extensions.getExtension('positron.positron-supervisor');
	if (!ext) {
		throw new Error('Positron Supervisor extension not found');
	}

	if (!ext.isActive) {
		await ext.activate();
	}

	return ext?.exports as PositronSupervisorApi;
}
