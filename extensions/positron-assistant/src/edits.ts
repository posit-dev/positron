/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from './constants';
const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

type LMTextEdit = { append: string } | { delete: string; replace: string };

/**
 * A provider for the copilot "Apply in Editor" functionality. Send text content of code blocks and
 * documents to a Language Model to calculate how to apply the code block within the document.
 */
export const editsProvider: vscode.MappedEditsProvider = {
	provideMappedEdits: async function (
		document: vscode.TextDocument,
		codeBlocks: string[],
		context: vscode.MappedEditsContext,
		token: vscode.CancellationToken
	): Promise<vscode.WorkspaceEdit | null> {
		const workspaceEdit = new vscode.WorkspaceEdit();
		for (const block of codeBlocks) {
			const text = document.getText();
			const json = await mapEdit(text, block, token);
			if (!json) {
				return null;
			}

			const edits = JSON.parse(json) as LMTextEdit[];
			for (const edit of edits) {
				if ('append' in edit) {
					const lastLine = document.lineAt(document.lineCount - 1);
					const endPosition = lastLine.range.end;
					const append = lastLine.isEmptyOrWhitespace ? edit.append : `\n${edit.append}`;
					workspaceEdit.insert(document.uri, endPosition, append);
				} else {
					const deleteText = edit.delete;
					const startPos = text.indexOf(deleteText);
					const startPosition = document.positionAt(startPos);
					const endPosition = document.positionAt(startPos + deleteText.length);
					const range = new vscode.Range(startPosition, endPosition);
					workspaceEdit.replace(document.uri, range, edit.replace);
				}
			}
		}
		return workspaceEdit;
	}
};

async function mapEdit(document: string, block: string, token: vscode.CancellationToken): Promise<string | null> {
	const system: string = await fs.promises.readFile(`${mdDir}/prompts/chat/mapedit.md`, 'utf8');
	const models = await vscode.lm.selectChatModels();

	if (models.length === 0) {
		throw new Error('No language models available for mapped edit');
	}

	// TODO: Use the language model currently selected in the chat interface.
	const response = await models[0].sendRequest([
		vscode.LanguageModelChatMessage.User(
			JSON.stringify({ document, block })
		)
	], { modelOptions: { system } }, token);

	let replacement = '';
	for await (const delta of response.text) {
		if (token.isCancellationRequested) {
			return null;
		}
		replacement += delta;
	}
	return replacement;
}
