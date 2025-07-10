/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

function getDefaultChatLogFileName(): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `positron-chat-export-${timestamp}.json`;
}

async function writeChatFile(fileUri: vscode.Uri): Promise<void> {
	const chatJson = await positron.ai.getChatExport();
	const fileBuffer = Buffer.from(JSON.stringify(chatJson, null, 2));
	await vscode.workspace.fs.writeFile(fileUri, fileBuffer);
}

async function showExportNotification(fileUri: vscode.Uri): Promise<void> {
	const chatExportedMessage = vscode.l10n.t('Chat log exported to: {0}', fileUri.path);
	const openFileButtonText = vscode.l10n.t('Open chat log');
	const selection = await vscode.window.showInformationMessage(
		chatExportedMessage,
		openFileButtonText
	);
	if (selection === openFileButtonText) {
		await vscode.window.showTextDocument(fileUri);
	}
}

/**
 * Exports the currently focused chat conversation to a file in the workspace.
 */
export async function exportChatToFileInWorkspace(): Promise<void> {
	const fileName = getDefaultChatLogFileName();
	const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0].uri || vscode.Uri.file('.'), fileName);
	await writeChatFile(fileUri);
	await showExportNotification(fileUri);
}

/**
 * Exports the currently focused chat conversation to a user-selected file.
 * Prompts the user for a file name and location to save the chat log.
 */
export async function exportChatToUserSpecifiedLocation(): Promise<void> {
	// Ask the user for the file name and location to export the chat log.
	const fileName = await vscode.window.showInputBox({
		prompt: vscode.l10n.t('Enter the file name to export the chat log to'),
		value: getDefaultChatLogFileName(),
	});
	if (!fileName) {
		return; // User cancelled the input.
	}
	const fileUri = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(fileName),
		filters: {
			'JSON files': ['json']
		},
	});
	if (!fileUri) {
		return; // User cancelled the save dialog.
	}

	// Write the file and show a notification when done.
	await writeChatFile(fileUri);
	await showExportNotification(fileUri);
}
