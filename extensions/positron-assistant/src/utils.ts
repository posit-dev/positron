/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LanguageModelCacheBreakpointType, LanguageModelDataPartMimeType, PromptInstructionsReference, RuntimeSessionReference } from './types.js';

/**
 * Convert chat participant history into an array of VSCode language model messages.
 */
export function toLanguageModelChatMessage(turns: vscode.ChatContext['history']): vscode.LanguageModelChatMessage2[] {
	return turns.map((turn) => {
		if (turn instanceof vscode.ChatRequestTurn) {
			let textValue = turn.prompt;
			if (turn.command) {
				textValue = `${turn.command} ${turn.prompt}`;
			}
			return vscode.LanguageModelChatMessage.User(textValue);
		} else if (turn.result.errorDetails) {
			return vscode.LanguageModelChatMessage.Assistant(`ERROR MESSAGE: "${turn.result.errorDetails.message}"`);
		} else {
			const textValue = turn.response.reduce((acc, content) => {
				if (content instanceof vscode.ChatResponseMarkdownPart) {
					return acc + content.value.value;
				} else if (content instanceof vscode.ChatResponseTextEditPart) {
					return acc + `\n\nSuggested text edits: ${JSON.stringify(content.edits)}\n\n`;
				} else if (content instanceof vscode.ChatResponseAnchorPart) {
					return acc + `\n\nAnchor: ${content.title ? `${content.title} ` : ''}${JSON.stringify(content.value2)}\n\n`;
				} else if (content instanceof vscode.ChatResponseCommandButtonPart) {
					return acc;
				} else {
					// TODO: Lower more history entry types to text.
					throw new Error(`Unsupported response kind when lowering chat agent response: ${content.constructor.name}`);
				}
			}, '');
			return textValue === '' ? null : vscode.LanguageModelChatMessage.Assistant(textValue);
		}
	}).filter((message) => !!message);
}

export enum ChatImageMimeType {
	PNG = 'image/png',
	JPEG = 'image/jpeg',
	GIF = 'image/gif',
	WEBP = 'image/webp',
	BMP = 'image/bmp',
}

export function isChatImageMimeType(mimeType: string): mimeType is ChatImageMimeType {
	return Object.values(ChatImageMimeType).includes(mimeType as ChatImageMimeType);
}

/** Whether a chat request is from an inline editor context. */
export function isTextEditRequest(request: vscode.ChatRequest):
	request is vscode.ChatRequest & { location2: vscode.ChatRequestEditorData } {
	return request.location2 instanceof vscode.ChatRequestEditorData;
}

/**
 * Convert a URI to a string suitable for language models.
 *
 * Currently, file URIs are converted to workspace-relative paths and
 * other URIs are converted to their string representation.
 */
export function uriToString(uri: vscode.Uri): string {
	if (uri.scheme === 'file') {
		return vscode.workspace.asRelativePath(uri);
	}
	return uri.toString();
}

/**
 * Checks if there is an open workspace folder.
 * This is useful to determine if certain tools can be used, as they require an open workspace folder.
 * @returns Whether there is an open workspace folder.
 */
export function isWorkspaceOpen(): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	return !!workspaceFolders && workspaceFolders.length > 0;
}

/**
 * Create a language model part that represents a cache control point.
 * @returns A language model part representing the cache control point.
 */
export function languageModelCacheBreakpointPart(): vscode.LanguageModelDataPart {
	// By matching the Copilot extension, other extensions that use models from either Copilot
	// or Positron Assistant can set cache breakpoints with the same schema.
	// See: https://github.com/microsoft/vscode-copilot-chat/blob/6aeac371813be9037e74395186ec5b5b94089245/src/extension/byok/vscode-node/anthropicMessageConverter.ts#L22
	return vscode.LanguageModelDataPart.text(LanguageModelCacheBreakpointType.Ephemeral, LanguageModelDataPartMimeType.CacheControl);
}

/**
 * Type guard to check if a reference is a RuntimeSessionReference.
 *
 * This function validates that the reference object has the expected structure
 * of a RuntimeSessionReference.
 */
export function isRuntimeSessionReference(value: unknown): value is RuntimeSessionReference {
	return typeof value === 'object' && value !== null &&
		'activeSession' in value &&
		'variables' in value &&
		Array.isArray(value.variables);
}

/**
 * Type guard to check if a reference is a prompt instructions file
 */
export function isPromptInstructionsReference(reference: unknown): reference is PromptInstructionsReference {
	return typeof reference === 'object' && reference !== null &&
		'modelDescription' in reference &&
		'name' in reference &&
		'id' in reference && typeof reference.id === 'string' &&
		'value' in reference && reference.value instanceof vscode.Uri &&
		reference.id.includes('vscode.prompt.instructions');
}

/**
 * Check if a finish reason indicates the response was truncated due to the max output token limit.
 */
export function isMaxTokensFinishReason(finishReason: string | undefined): boolean {
	return finishReason === 'length' || finishReason === 'max_tokens';
}
