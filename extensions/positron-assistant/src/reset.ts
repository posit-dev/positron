/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { generateDiagnosticsContent } from './diagnostics';
import { CopilotService } from './copilot';
import { getStoredModels, GlobalSecretStorage } from './config';
import { disposeModels, log } from './extension';

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function saveDiagnosticsToFile(context: vscode.ExtensionContext): Promise<string | undefined> {
	try {
		const content = await generateDiagnosticsContent(context, log);

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const filename = `positron-assistant-diagnostics-${timestamp}.md`;
		const storageUri = context.globalStorageUri;

		// Ensure the directory exists
		await vscode.workspace.fs.createDirectory(storageUri);

		const fileUri = vscode.Uri.joinPath(storageUri, filename);
		const fileBuffer = Buffer.from(content, 'utf8');

		await vscode.workspace.fs.writeFile(fileUri, fileBuffer);

		return fileUri.fsPath;
	} catch (error) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to save diagnostics: {0}', formatError(error))
		);
		return undefined;
	}
}

async function clearAssistantState(context: vscode.ExtensionContext): Promise<void> {
	const storedModels = getStoredModels(context);
	disposeModels();

	const globalStateKeys = context.globalState.keys();
	for (const key of globalStateKeys) {
		if (key.startsWith('positron.assistant')) {
			await context.globalState.update(key, undefined);
		}
	}

	const storage = new GlobalSecretStorage(context);
	for (const model of storedModels) {
		try {
			await storage.delete(`apiKey-${model.id}`);
		} catch (error) {
			log.trace(`Failed to delete API key for model ${model.id}: ${formatError(error)}`);
		}
	}
}

async function clearChatHistory(): Promise<void> {
	try {
		await vscode.commands.executeCommand('workbench.action.chat.clearHistory');
		await vscode.commands.executeCommand('workbench.action.chat.clearInputHistory');
	} catch (error) {
		vscode.window.showWarningMessage(
			vscode.l10n.t('Failed to clear chat history: {0}', formatError(error))
		);
	}
}

/**
 * Reset all Positron Assistant state.
 *
 * This command:
 * 1. Optionally generates and saves diagnostic information (user choice)
 * 2. Signs out of all providers
 * 3. Clears all Assistant state (global state and secrets)
 * 4. Deletes all chat history
 * 5. Reloads the window for a clean start
 */
export async function resetAssistantState(context: vscode.ExtensionContext): Promise<void> {
	// Show confirmation dialog with options
	const resetWithDiagnostics = vscode.l10n.t('Reset with Diagnostics');
	const resetWithoutDiagnostics = vscode.l10n.t('Reset without Diagnostics');

	const result = await vscode.window.showWarningMessage(
		vscode.l10n.t('Reset Positron Assistant State'),
		{
			modal: true,
			detail: vscode.l10n.t(
				'This will:\n' +
				'• Sign out of all language model providers\n' +
				'• Clear all Assistant configuration and state\n' +
				'• Delete all chat history\n' +
				'• Reload the window\n\n' +
				'This action cannot be undone.\n\n' +
				'You can optionally save diagnostic information before resetting. This may be helpful for troubleshooting issues. The diagnostics file will be opened after the window reloads.'
			)
		},
		resetWithDiagnostics,
		resetWithoutDiagnostics
	);

	if (result === undefined) {
		return;
	}

	const saveDiagnostics = result === resetWithDiagnostics;

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Resetting Positron Assistant'),
			cancellable: false
		},
		async (progress) => {
			// Step 1: Save diagnostics (optional)
			if (saveDiagnostics) {
				progress.report({ message: vscode.l10n.t('Saving diagnostics...') });
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
			}

			// Step 2: Sign out of providers
			progress.report({ message: vscode.l10n.t('Signing out of providers...') });
			await CopilotService.instance().signOut();

			// Step 3: Clear Assistant state
			progress.report({ message: vscode.l10n.t('Clearing Assistant state...') });
			await clearAssistantState(context);

			// Step 4: Clear chat history
			progress.report({ message: vscode.l10n.t('Clearing chat history...') });
			await clearChatHistory();

			// Step 5: Reload window
			progress.report({ message: vscode.l10n.t('Reloading window...') });

			vscode.window.showInformationMessage(
				vscode.l10n.t('Assistant state has been reset. The window will now reload.'),
				{ modal: true }
			);

			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	);
}
