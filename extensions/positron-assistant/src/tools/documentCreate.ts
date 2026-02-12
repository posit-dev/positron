/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../log.js';

interface CreateDocumentInput {
	filePath: string;
	workspaceFolder?: string;
	content?: string;
	errorIfExists?: boolean;
}

export const DocumentCreateTool = vscode.lm.registerTool<CreateDocumentInput>(PositronAssistantToolName.DocumentCreate, {
	prepareInvocation: async (_options, _token) => {
		return {
			// The message shown when the code is actually executing.
			// Positron appends '...' to this message.
			invocationMessage: vscode.l10n.t('Creating document'),
			pastTenseMessage: vscode.l10n.t('Created document'),
		};
	},
	invoke: async (options, _token) => {
		log.trace(`[${PositronAssistantToolName.DocumentCreate}] Invoked with options: ${JSON.stringify(options.input, null, 2)}`);

		const { filePath, workspaceFolder, content, errorIfExists } = options.input;
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error(vscode.l10n.t(`Can't create document ${filePath} because no workspace folders are open. Open a workspace folder before using this tool.`));
		}

		// Determine the file URI based on the workspace folder
		const folder = (!!workspaceFolder && workspaceFolders.find(folder => folder.name === workspaceFolder)) || workspaceFolders[0];
		const fileUri = vscode.Uri.joinPath(folder.uri, filePath);

		// Handle the existence of the file
		const documentExists = await fileExists(fileUri);
		if (documentExists && errorIfExists) {
			log.error(`[${PositronAssistantToolName.DocumentCreate}] Cannot create file "${fileUri.fsPath}" as it already exists in the workspace`);
			throw new Error(vscode.l10n.t('Cannot create file "{0}" as it already exists in the workspace.', fileUri.fsPath));
		}
		if (!documentExists) {
			try {
				log.trace(`[${PositronAssistantToolName.DocumentCreate}] File does not exist at ${fileUri.fsPath}, creating new document.`);
				const fileContent = content ? Buffer.from(content, 'utf8') : Buffer.from('', 'utf8');
				await vscode.workspace.fs.writeFile(fileUri, fileContent);
				log.info(`[${PositronAssistantToolName.DocumentCreate}] Created document at ${fileUri.fsPath}`);
			} catch (error) {
				if ((error as vscode.FileSystemError).code !== 'FileNotFound') {
					throw error; // Re-throw if it's not a "file not found" error
				}
			}
		}

		// Open the document in the editor
		await vscode.window.showTextDocument(fileUri);

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`Document ${documentExists ? 'already exists ' : 'created '} at: ${fileUri}`)
		]);
	}
});

const fileExists = async (filePath: vscode.Uri): Promise<boolean> => {
	try {
		await vscode.workspace.fs.stat(filePath);
		return true;
	} catch (error) {
		if ((error as vscode.FileSystemError).code === 'FileNotFound') {
			return false; // File does not exist
		}
		throw error; // Re-throw if it's a different error
	}
};
