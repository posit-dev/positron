/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';

import { CancellationToken, ChatRequest, ChatContext, ChatLocation, ChatParticipantDetectionResult, ChatParticipantMetadata, ProviderResult, chat } from 'vscode';
import { EXTENSION_ROOT_DIR } from './constants.js';
import { json } from 'stream/consumers';

const MD_DIR = `${EXTENSION_ROOT_DIR}/src/md/`;

function isDetectionResult(result: any): result is ChatParticipantDetectionResult {
	return result && typeof result.participant === 'string' && (typeof result.command === 'string' || typeof result.command === 'undefined');
}

/**
 * Provides participant detection for chat interactions in the Positron Assistant extension.
 * Determines the relevant chat participant and command based on the user's prompt and available participants.
 */
class PositronAssistantParticipantDetector implements vscode.ChatParticipantDetectionProvider {
	/**
	 * Provides participant detection for chat interactions.
	 * Determines the relevant chat participant and command based on the user's prompt and available participants.
	 *
	 * @param chatRequest - The chat request containing the user's prompt and context.
	 * @param context - The chat context for the current interaction.
	 * @param options - Options including available participants and chat location.
	 * @param token - Cancellation token for aborting the operation.
	 * @returns A promise resolving to a ChatParticipantDetectionResult or null if detection fails.
	 */
	async provideParticipantDetection(
		chatRequest: ChatRequest,
		_context: ChatContext,
		options: { participants?: ChatParticipantMetadata[]; location: ChatLocation },
		_token: CancellationToken
	): Promise<vscode.ChatParticipantDetectionResult | null | undefined> {
		// Check if participants are provided and non-empty
		const { participants } = options;
		if (participants && participants.length > 0) {
			// Extract the user's prompt from the chat request
			const userPrompt = chatRequest.prompt;
			// Serialize participants to JSON for the model
			const participantJson = JSON.stringify(participants);

			// Send a request to the language model with participants and user prompt
			const result = await chatRequest.model.sendRequest([
				vscode.LanguageModelChatMessage.User(participantJson),
				vscode.LanguageModelChatMessage.User(userPrompt),
			], {
				modelOptions: {
					// System prompt instructs the model to return a JSON object or null
					system: await fs.promises.readFile(`${MD_DIR}/prompts/chat/participantDetection.md`, 'utf8'),
					// Pass the request ID through modelOptions for token usage tracking
					requestId: chatRequest.id,
				}
			});

			try {
				// Attempt to parse the model's response as JSON
				const jsonResult: any = await json(result.text);
				// Validate the structure of the parsed result
				if (isDetectionResult(jsonResult)) {
					return jsonResult;
				}
				// Return null if validation fails
				return null;
			} catch {
				// Return null if parsing fails
				return null;
			}
		}
		// Return null if no participants are provided
		return null;
	}
}

export function registerParticipantDetectionProvider() {
	vscode.chat.registerChatParticipantDetectionProvider(new PositronAssistantParticipantDetector());
}
