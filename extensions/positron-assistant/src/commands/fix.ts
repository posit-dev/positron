/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantChatContext } from '../participants.js';
import { PromptRenderer } from '../promptRender.js';

export const FIX_COMMAND = 'fix';

/**
 * Handler for the custom chat participant command `/fix`.
 */
export async function fixHandler(
	_request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	handleDefault: () => Promise<vscode.ChatResult | void>
) {
	response.progress('Preparing edits...');

	const prompt = PromptRenderer.renderCommandPrompt(FIX_COMMAND, _request, context).content;
	context.systemPrompt += `\n\n${prompt}`;

	return handleDefault();
}
