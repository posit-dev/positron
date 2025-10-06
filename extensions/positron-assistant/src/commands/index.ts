/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantChatContext } from '../participants.js';
import { registerFixCommand } from './fix.js';
import { registerQuartoCommand } from './quarto.js';
import { registerExplainCommand } from './explain.js';
import { registerDocCommand } from './doc.js';
import { registerConfigurationCommands } from './config.js';
import { SecretStorage } from '../config.js';

/**
 * A function that handles chat requests.
 *
 * @param request The chat request to handle.
 * @param context The chat context for the request.
 * @param response The response stream for the request.
 * @param token A cancellation token for the request.
 * @param handleDefault A function to call the default request handler.
 */
export interface IChatRequestHandler {
	(
		request: vscode.ChatRequest,
		context: PositronAssistantChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		handleDefault: () => Promise<vscode.ChatResult | void>
	): Promise<vscode.ChatResult | void>;
}

export function registerAssistantCommands(context: vscode.ExtensionContext, storage: SecretStorage) {
	registerFixCommand();
	registerExplainCommand();
	registerQuartoCommand();
	registerDocCommand();
	registerConfigurationCommands(context, storage);
}
