/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { generateDiagnosticsContent } from './diagnostics';
import { CopilotService } from './copilot';
import { PositLanguageModel } from './posit';
import { getStoredModels, GlobalSecretStorage } from './config';
import { disposeModels, log } from './extension';

/**
 * Save diagnostics to a file in the extension's global storage directory.
 * This is located in the user data directory and persists across sessions.
 */
async function saveDiagnosticsToFile(context: vscode.ExtensionContext): Promise<string | undefined> {
	try {
		// Generate the diagnostics content
		const content = await generateDiagnosticsContent(context, log);

		// Generate timestamp for filename
		const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');

		const filename = `positron-assistant-diagnostics-${timestamp}.md`;

		// Use the extension's global storage URI (in user data directory)
		const storageUri = context.globalStorageUri;

		// Ensure the directory exists
		await vscode.workspace.fs.createDirectory(storageUri);

		// Create the file URI in the storage directory
		const fileUri = vscode.Uri.joinPath(storageUri, filename);

		// Save to file
		const fileBuffer = Buffer.from(content, 'utf8');
		await vscode.workspace.fs.writeFile(fileUri, fileBuffer);

		return fileUri.fsPath;
	} catch (error) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to save diagnostics: {0}', error instanceof Error ? error.message : String(error))
		);
		return undefined;
	}
}

/**
 * Sign out of all providers and clear their authentication state.
 */
async function signOutAllProviders(context: vscode.ExtensionContext): Promise<void> {
	const storage = new GlobalSecretStorage(context);
	const storedModels = getStoredModels(context);

	// Track unique providers to sign out
	const providers = new Set<string>();
	storedModels.forEach(model => providers.add(model.provider));

	// Sign out of each provider
	for (const provider of providers) {
		try {
			if (provider === 'copilot') {
				await CopilotService.instance().signOut();
			} else if (provider === 'posit') {
				await PositLanguageModel.signOut(storage);
			}
			// Other providers that use OAuth or API keys will be cleared via secret storage
		} catch (error) {
			vscode.window.showWarningMessage(
				vscode.l10n.t('Failed to sign out of {0}: {1}', provider, error instanceof Error ? error.message : String(error))
			);
		}
	}
}

/**
 * Clear all Assistant state from global state and secret storage.
 */
async function clearAssistantState(context: vscode.ExtensionContext): Promise<void> {
	const storedModels = getStoredModels(context);
	disposeModels();

	// Clear global state
	// TO DO: REVIEW KEYS TO BE MORE SPECIFIC
	const globalStateKeys = context.globalState.keys();
	for (const key of globalStateKeys) {
		if (key.startsWith('positron.assistant') || key.includes('assistant')) {
			await context.globalState.update(key, undefined);
		}
	}

	// Clear secret storage - we need to clear known secret keys
	const storage = new GlobalSecretStorage(context);

	// Clear API keys for all stored models
	for (const model of storedModels) {
		try {
			await storage.delete(`apiKey-${model.id}`);
		} catch (error) {
			log.trace(`Failed to delete API key for model ${model.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// Clear the models list itself
	await context.globalState.update('positron.assistant.models', undefined);

	// Clear other known secret keys
	const knownSecrets = [
		'posit.token',
		'posit.refreshToken',
		'copilot.token'
	];

	for (const secret of knownSecrets) {
		try {
			await storage.delete(secret);
		} catch (error) {
			log.trace(`Failed to delete secret ${secret}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

/**
 * Clear all chat history and sessions.
 */
async function clearChatHistory(): Promise<void> {
	try {
		// Use VS Code's built-in command to clear all chat history
		await vscode.commands.executeCommand('workbench.action.chat.clearHistory');

		// Also clear the chat widget input history
		await vscode.commands.executeCommand('workbench.action.chat.clearInputHistory');
	} catch (error) {
		vscode.window.showWarningMessage(
			vscode.l10n.t('Failed to clear chat history: {0}', error instanceof Error ? error.message : String(error))
		);
	}
}

/**
 * Reset all Positron Assistant state.
 *
 * This command:
 * 1. Optionally generates and saves diagnostic information (user choice)
 * 2. Signs out of all providers (including Copilot)
 * 3. Clears all Assistant state (global state and secrets)
 * 4. Deletes all chat history
 * 5. Reloads the window for a clean start
 */
export async function resetAssistantState(context: vscode.ExtensionContext): Promise<void> {
	// Show confirmation dialog with options
	const result = await vscode.window.showWarningMessage(
		vscode.l10n.t('Reset Positron Assistant State'),
		{
			modal: true,
			detail: vscode.l10n.t(
				'This will:\n' +
				'• Sign out of all language model providers (including Copilot)\n' +
				'• Clear all Assistant configuration and state\n' +
				'• Delete all chat history\n' +
				'• Reload the window\n\n' +
				'This action cannot be undone.'
			)
		},
		vscode.l10n.t('Reset with Diagnostics'),
		vscode.l10n.t('Reset without Diagnostics')
	);

	if (result === undefined) {
		return;
	}

	const saveDiagnostics = result === vscode.l10n.t('Reset with Diagnostics');

	// Show progress
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Resetting Positron Assistant'),
			cancellable: false
		},
		async (progress) => {
			let currentStep = 0;
			const stepIncrement = saveDiagnostics ? 20 : 25;

			// Step 1: Save diagnostics (optional)
			if (saveDiagnostics) {
				progress.report({ increment: 0, message: vscode.l10n.t('Saving diagnostics...') });
				const diagnosticsPath = await saveDiagnosticsToFile(context);
				if (diagnosticsPath) {
					vscode.window.showInformationMessage(
						vscode.l10n.t('Diagnostics saved to: {0}', diagnosticsPath)
					);
					// Open the diagnostics file so it will be restored after reload
					const fileUri = vscode.Uri.file(diagnosticsPath);
					const document = await vscode.workspace.openTextDocument(fileUri);
					await vscode.window.showTextDocument(document, { preview: false });
				}
				currentStep += stepIncrement;
			}

			// Step 2: Sign out of all providers
			progress.report({ increment: currentStep, message: vscode.l10n.t('Signing out of providers...') });
			await signOutAllProviders(context);
			currentStep += stepIncrement;

			// Step 3: Clear Assistant state
			progress.report({ increment: currentStep, message: vscode.l10n.t('Clearing Assistant state...') });
			await clearAssistantState(context);
			currentStep += stepIncrement;

			// Step 4: Clear chat history
			progress.report({ increment: currentStep, message: vscode.l10n.t('Clearing chat history...') });
			await clearChatHistory();
			currentStep += stepIncrement;

			// Step 5: Reload window
			progress.report({ increment: currentStep, message: vscode.l10n.t('Reloading window...') });

			vscode.window.showInformationMessage(
				vscode.l10n.t('Assistant state has been reset. The window will now reload.')
			);

			// Reload the window
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	);
}
