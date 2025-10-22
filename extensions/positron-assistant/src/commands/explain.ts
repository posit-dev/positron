/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantChatContext } from '../participants.js';
import { PromptRenderer } from '../promptRender.js';

export const EXPLAIN_COMMAND = 'explain';

/**
 * Handler for the custom chat participant command `/explain`.
 */
export async function explainHandler(
	_request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	_response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	handleDefault: () => Promise<vscode.ChatResult | void>
) {

	const prompt = PromptRenderer.renderCommandPrompt(EXPLAIN_COMMAND, _request).content;
	context.systemPrompt += `\n\n${prompt}`;

	return handleDefault();
}
