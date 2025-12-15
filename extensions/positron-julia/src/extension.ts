/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { JuliaRuntimeManager } from './runtime-manager';
import { registerCommands } from './commands';
import { PositronSupervisorApi } from './positron-supervisor';
import { JuliaLanguageClient } from './language-client';
import { juliaRuntimeDiscoverer } from './provider';
import { registerCompletionProvider } from './completions';

export const LOGGER = vscode.window.createOutputChannel('Julia Language Pack', { log: true });

let languageClient: JuliaLanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
	const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
		LOGGER.appendLine(vscode.l10n.t('Log level: {0}', vscode.LogLevel[logLevel]));
	};
	context.subscriptions.push(LOGGER.onDidChangeLogLevel(onDidChangeLogLevel));
	onDidChangeLogLevel(LOGGER.logLevel);

	// Create and register the Julia runtime manager
	const juliaRuntimeManager = new JuliaRuntimeManager(context);
	positron.runtime.registerLanguageRuntimeManager('julia', juliaRuntimeManager);

	// Register commands
	registerCommands(context, juliaRuntimeManager);

	// NOTE: Runtime completion provider disabled - Silent execution mode doesn't return
	// results, and Transient mode pollutes the console. Need proper silent execution
	// support in positron-supervisor. See TODO-LATER.md.
	// registerCompletionProvider(context);

	// Start language server when a Julia file is opened
	// Also check if any Julia files are already open (e.g., after reload)
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(async (document) => {
			if (document.languageId === 'julia' && !languageClient) {
				await startLanguageServer(context).catch(error => {
					LOGGER.warn(`Language server not started: ${error.message}`);
				});
			}
		})
	);

	// Check if Julia files are already open (handles reload case)
	const hasOpenJuliaFiles = vscode.workspace.textDocuments.some(
		doc => doc.languageId === 'julia'
	);
	if (hasOpenJuliaFiles) {
		startLanguageServer(context).catch(error => {
			LOGGER.warn(`Language server not started: ${error.message}`);
		});
	}

	LOGGER.info('Positron Julia extension activated');
}

/**
 * Starts the Julia Language Server with a specific Julia installation.
 * If no installation is provided, uses the first available one.
 *
 * @param context Extension context
 * @param installation Optional specific Julia installation to use
 */
async function startLanguageServer(
	context: vscode.ExtensionContext,
	installation?: any
): Promise<void> {
	// Check if language server is enabled
	const config = vscode.workspace.getConfiguration('positron.julia');
	if (!config.get<boolean>('languageServer.enabled', true)) {
		LOGGER.info('Julia Language Server is disabled');
		return;
	}

	// If no installation provided, find the first available one
	if (!installation) {
		for await (const inst of juliaRuntimeDiscoverer()) {
			installation = inst;
			break;
		}
	}

	if (!installation) {
		LOGGER.warn('No Julia installation found for language server');
		return;
	}

	// Create and start the language client
	languageClient = new JuliaLanguageClient(context.extensionPath);
	context.subscriptions.push(languageClient);

	try {
		await languageClient.start(installation);
	} catch (error) {
		LOGGER.error(`Failed to start language server: ${error}`);
		languageClient = undefined;
	}
}

export function deactivate() {
	LOGGER.info('Positron Julia extension deactivated');
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

/**
 * Ensures the Language Server is running with the specified Julia version.
 * Restarts the LS if it's running with a different version.
 * Called when creating a new session to ensure version compatibility.
 */
export async function ensureLanguageServerForVersion(
	installation: any,
	context: vscode.ExtensionContext
): Promise<void> {
	// If no LS is running, start it with this version
	if (!languageClient) {
		await startLanguageServer(context, installation);
		return;
	}

	// If LS is running with a different Julia version, restart it
	// Access private _installation field (TypeScript limitation)
	const currentInstallation = (languageClient as unknown as { _installation?: { version: string } })._installation;
	const currentVersion = currentInstallation?.version;
	if (currentVersion && currentVersion !== installation.version) {
		LOGGER.info(`Restarting Language Server: switching from Julia ${currentVersion} to ${installation.version}`);
		await languageClient.stop();
		languageClient = undefined;
		await startLanguageServer(context, installation);
	}
}
