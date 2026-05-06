/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RequestType } from 'vscode-languageclient';

import {
	CompletionTriggerKind,
	type InlineEditParams,
	type InlineEditResult,
} from './types.js';
import { getLanguageClientManager } from './client.js';
import { getLLMConfiguration } from './model.js';
import { sendFeedback } from './feedback.js';
import { getSessionVariables } from './variables.js';
import { log } from './extension.js';

type EnclosingBlock = {
	text: string;
	startLine: number;
	endLine: number;
};

export const debounceDelayMs = 200;

const inlineEditRequest = new RequestType<InlineEditParams, InlineEditResult | null, void>(
	'textDocument/inlineEdit',
);

export async function generateSuggestion(
	document: vscode.TextDocument,
	position: vscode.Position,
): Promise<vscode.InlineCompletionItem | null> {
	try {
		const clientManager = getLanguageClientManager();
		if (!clientManager) {
			return null;
		}

		if (document.lineAt(position.line).text.includes('```')) {
			return null;
		}

		let startLine = position.line;
		for (let i = 1; i <= 5; i++) {
			const line = position.line - i;
			if (line < 0 || document.lineAt(line).text.includes('```')) {
				break;
			}
			startLine = line;
		}

		let endLine = position.line;
		for (let i = 1; i <= 5; i++) {
			const line = position.line + i;
			if (line >= document.lineCount || document.lineAt(line).text.includes('```')) {
				break;
			}
			endLine = line;
		}

		const enclosingBlocks = await getEnclosingBlocks(document, position);
		const contextBlock = enclosingBlocks.filter((block) => block.endLine - block.startLine <= 50).pop();

		let contextStartLine = Math.max(0, startLine - 5);
		let contextEndLine = Math.min(document.lineCount - 1, endLine + 5);
		if (contextBlock && contextBlock.endLine - contextBlock.startLine > 10) {
			contextStartLine = contextBlock.startLine;
			contextEndLine = contextBlock.endLine;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		const relativePath = workspaceFolder ? vscode.workspace.asRelativePath(document.uri, false) : document.uri.fsPath;

		let excerpt = '```' + relativePath + '\n';

		for (let i = contextStartLine; i < startLine; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		excerpt += '<|editable_region_start|>\n';

		for (let i = startLine; i < position.line; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		const currentLine = document.lineAt(position.line);
		const beforeCursor = currentLine.text.substring(0, position.character);
		const afterCursor = currentLine.text.substring(position.character);
		excerpt += beforeCursor + '<|user_cursor_is_here|>' + afterCursor + '\n';

		for (let i = position.line + 1; i <= endLine; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		excerpt += '<|editable_region_end|>\n';

		for (let i = endLine + 1; i <= contextEndLine; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		excerpt += '```';

		const referencedNames = new Set(excerpt.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []);
		const sessionVariableContexts = await getSessionVariables(referencedNames);

		const llmConfig = await getLLMConfiguration();
		if (!llmConfig) {
			return null;
		}

		const params: InlineEditParams = {
			textDocument: { uri: document.uri.toString() },
			position: { line: position.line, character: position.character },
			variables: sessionVariableContexts,
			context: {
				triggerKind: CompletionTriggerKind.Invoked,
			},
			selection: {
				excerpt,
				editableRegionStart: { line: startLine, character: 0 },
				editableRegionEnd: { line: endLine, character: document.lineAt(endLine).text.length },
			},
			llmConfig,
		};

		const logParams = {
			...params,
			llmConfig: {
				...params.llmConfig,
				accessToken: '[***]'
			}
		};
		log.trace(`[request] ${JSON.stringify(logParams)}`);

		const result = await clientManager.client.sendRequest(inlineEditRequest, params);
		if (!result) {
			return null;
		}

		const suggestion = result.edits[0];

		if (!suggestion || suggestion.text.trim() === '') {
			sendFeedback(result.correlationId, 'filtered');
			return null;
		}

		// Deal with the model returning too few closing quotes when ending its response
		if (suggestion.text.endsWith('\n```')) {
			suggestion.text = suggestion.text.substring(0, suggestion.text.length - 4);
		}

		const range = new vscode.Range(
			suggestion.range.start.line,
			suggestion.range.start.character,
			suggestion.range.end.line,
			suggestion.range.end.character,
		);

		log.trace(`[result] ${JSON.stringify({ text: suggestion.text, range: suggestion.range, correlationId: result.correlationId })}`);

		const showRange = new vscode.Range(contextStartLine, 0, contextEndLine, Number.MAX_SAFE_INTEGER);

		// Check if we should display this suggestion as ghost text
		const beforeText = document.getText(new vscode.Range(range.start, position));
		const afterText = document.getText(new vscode.Range(position, range.end));
		const beforeEqual = suggestion.text.startsWith(beforeText);
		const afterEqual = suggestion.text.endsWith(afterText);

		let item: vscode.InlineCompletionItem;

		if (beforeEqual && afterEqual) {
			const insertText = suggestion.text.slice(beforeText.length, suggestion.text.length - afterText.length);
			item = new vscode.InlineCompletionItem(insertText, new vscode.Range(position, position));
		} else {
			item = new vscode.InlineCompletionItem(suggestion.text, range);
			item.isInlineEdit = true;
			item.showInlineEditMenu = true;
			item.showRange = showRange;
			item.action = {
				title: 'Learn More',
				command: 'next-edit-suggestions.learnMore',
				tooltip: 'Learn more about Posit AI',
			};
		}

		item.correlationId = result.correlationId;

		return item;
	} catch (error) {
		log.error('Error generating suggestion from LSP:', error);
		return null;
	}
}

async function getEnclosingBlocks(document: vscode.TextDocument, position: vscode.Position): Promise<EnclosingBlock[]> {
	const blocks: EnclosingBlock[] = [];

	const selectionRanges = await vscode.commands.executeCommand<vscode.SelectionRange[]>(
		'vscode.executeSelectionRangeProvider',
		document.uri,
		[position],
	);

	if (selectionRanges && selectionRanges.length > 0) {
		let current: vscode.SelectionRange | undefined = selectionRanges[0];
		while (current) {
			const text = document.getText(current.range);
			blocks.push({
				text,
				startLine: current.range.start.line,
				endLine: current.range.end.line,
			});
			current = current.parent;
		}
	}

	return blocks;
}
