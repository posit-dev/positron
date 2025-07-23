/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatPrompt } from '../prompts/participants/ChatPrompt';
import { PromptRenderer } from '../promptRenderer';
import * as vscode from 'vscode';

/**
 * Demo integration showing how to use prompt-tsx components in participants.
 * This replaces the manual string concatenation with structured prompt rendering.
 */
export async function getChatSystemPrompt(request: vscode.ChatRequest): Promise<string> {
	// Instead of manually reading and concatenating markdown files:
	// const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
	// const filepaths = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'filepaths.md'), 'utf8');
	// const languages = await this.getActiveSessionInstructions();
	// return defaultSystem + '\n\n' + filepaths + '\n\n' + languages;

	try {
		// Use the structured prompt-tsx approach
		const rendered = await PromptRenderer.render(
			ChatPrompt,
			{
				includeFilepaths: true,
				activeSessions: await getActiveSessionLanguages(),
				priority: 100
			},
			request.model,
			'chat-prompt' // cache key
		);

		return rendered;
	} catch (error) {
		console.error('Error rendering chat prompt:', error);
		// Fallback to a basic prompt
		return 'You are a helpful AI assistant specialized in coding and data science tasks.';
	}
}

/**
 * Helper function to get active language sessions (placeholder implementation)
 */
async function getActiveSessionLanguages(): Promise<string[]> {
	// This would be replaced with actual session detection logic
	// For now, return common languages as a demo
	return ['python', 'r', 'javascript'];
}

/**
 * Demo function showing how other participants would work
 */
export async function getAgentSystemPrompt(request: vscode.ChatRequest): Promise<string> {
	try {
		const rendered = await PromptRenderer.render(
			ChatPrompt, // Could create AgentPrompt component
			{
				includeFilepaths: false,
				activeSessions: ['python'], // Agent might focus on specific languages
				priority: 100
			},
			request.model,
			'agent-prompt'
		);

		return rendered;
	} catch (error) {
		console.error('Error rendering agent prompt:', error);
		return 'You are an AI agent that can execute tasks and use tools.';
	}
}
