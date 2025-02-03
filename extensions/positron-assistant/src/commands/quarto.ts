/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from '../constants';
import { toLanguageModelChatMessage } from '../utils';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

export const QUARTO_COMMAND = 'quarto';
export const QUARTO_DESCRIPTION = 'Convert the conversation so far into a new Quarto document.';

export async function quartoHandler(
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken
) {
	const system = await fs.promises.readFile(`${mdDir}/prompts/chat/quarto.md`, 'utf8');

	response.markdown('Okay!');
	response.progress('Creating new Quarto document...');
	const document = await vscode.workspace.openTextDocument({
		language: 'quarto',
		content: ''
	});
	const editor = await vscode.window.showTextDocument(document);

	const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);
	messages.push(...[
		vscode.LanguageModelChatMessage.User('Convert to Qmd.'),
	]);

	response.progress('Writing Quarto document...');
	const modelResponse = await request.model.sendRequest(messages, {
		modelOptions: { system },
	}, token);

	for await (const chunk of modelResponse.text) {
		if (token.isCancellationRequested) {
			break;
		}

		// Stream in content to the end of the document
		await editor.edit((builder) => {
			const lastLine = editor.document.lineCount - 1;
			const position = new vscode.Position(lastLine, editor.document.lineAt(lastLine).text.length);
			builder.insert(position, chunk);
		});

		// Check if the last line was visible before the edit
		const lastVisibleRange = editor.visibleRanges[editor.visibleRanges.length - 1];
		const atBottom = lastVisibleRange.end.line >= editor.document.lineCount - 3;

		// If we were at the bottom, scroll to the new bottom
		if (atBottom) {
			const newLastLine = editor.document.lineCount - 1;
			const newPosition = new vscode.Position(newLastLine, 0);
			editor.revealRange(
				new vscode.Range(newPosition, newPosition),
				vscode.TextEditorRevealType.Default
			);
		}
	}
}
