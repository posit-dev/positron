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

	// Start the language server in the background
	startLanguageServer(context).catch(error => {
		LOGGER.warn(`Language server not started: ${error.message}`);
	});

	LOGGER.info('Positron Julia extension activated');
}

/**
 * Starts the Julia Language Server using the first available Julia installation.
 */
async function startLanguageServer(context: vscode.ExtensionContext): Promise<void> {
	// Check if language server is enabled
	const config = vscode.workspace.getConfiguration('positron.julia');
	if (!config.get<boolean>('languageServer.enabled', true)) {
		LOGGER.info('Julia Language Server is disabled');
		return;
	}

	// Find the first available Julia installation
	let installation = null;
	for await (const inst of juliaRuntimeDiscoverer()) {
		installation = inst;
		break;
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
