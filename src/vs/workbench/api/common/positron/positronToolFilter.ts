/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ParticipantID } from '../../../contrib/positronAssistant/common/positronAssistantParticipants.js';
import { POSITRON_ASSISTANT_TOOL_TAG, PositronAssistantToolName, TOOL_TAG_REQUIRES_ACTIONS, TOOL_TAG_REQUIRES_SESSION, TOOL_TAG_REQUIRES_WORKSPACE } from '../../../contrib/positronAssistant/common/positronAssistantToolNames.js';

/**
 * Filters a chat request's available tools down to those Positron considers
 * enabled for the current context.
 *
 * This is the tool-availability policy Positron applies to chat clients such
 * as Copilot Chat. It mirrors the filtering the Positron Assistant chat
 * participants apply to their own requests.
 *
 * @param request The chat request the tools would be used for.
 * @param tools The full list of candidate tools.
 * @param isWorkspaceOpen Whether a workspace is currently open.
 * @param positronParticipantId The id of the Positron participant making the
 * request, if any. Undefined when called for a non-Positron participant such
 * as Copilot Chat.
 * @returns The names of the tools that are enabled.
 */
export function getEnabledTools(
	request: vscode.ChatRequest,
	tools: readonly vscode.LanguageModelToolInformation[],
	isWorkspaceOpen: boolean,
	positronParticipantId?: string): string[] {

	const enabledTools: string[] = [];

	// Build the set of languages for which the request carries an active
	// session context. See IChatRuntimeSessionContext for the shape of these
	// reference values.
	const activeSessions = new Set<string>();
	for (const reference of request?.references ?? []) {
		const value = reference.value as { activeSession?: { languageId: string } };
		if (value.activeSession) {
			activeSessions.add(value.activeSession.languageId);
		}
	}

	// Readable mode flags. A non-Positron participant (undefined id) is treated
	// as agent mode.
	const inChatPane = request.location2 === undefined;
	const isAgentMode = positronParticipantId === ParticipantID.Agent || positronParticipantId === undefined;
	const isAskMode = positronParticipantId === ParticipantID.Chat;
	const isStreamingInlineEditor = positronParticipantId === ParticipantID.Editor;

	for (const tool of tools) {
		// Skip tools the user explicitly disabled via the Configure Tools
		// picker, which is only available in agent mode.
		if (isAgentMode && request.tools?.get(tool) === false) {
			continue;
		}

		// No tools in the terminal.
		if (positronParticipantId === ParticipantID.Terminal) {
			continue;
		}

		// No tools in an inline editor chat with streaming edits.
		if (isStreamingInlineEditor) {
			continue;
		}

		// Skip tools that require a workspace when none is open.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_WORKSPACE) && !isWorkspaceOpen) {
			continue;
		}

		// Skip tools that require an active session in a language that has none.
		const missingLanguage = tool.tags
			.filter(tag => tag.startsWith(TOOL_TAG_REQUIRES_SESSION + ':'))
			.map(tag => tag.split(':')[1])
			.find(lang => !activeSessions.has(lang));
		if (missingLanguage) {
			continue;
		}

		// Skip action tools in Ask mode.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_ACTIONS) && isAskMode) {
			continue;
		}

		// Skip Positron-only tools when there is no Positron participant.
		if (tool.name.startsWith('positron') && positronParticipantId === undefined) {
			continue;
		}

		switch (tool.name) {
			// The execute code tool is only available in the Chat pane in agent
			// mode; the other panes have no affordance for confirming executions
			// and it does not currently support notebook mode.
			case PositronAssistantToolName.ExecuteCode:
				if (!(inChatPane && isAgentMode)) {
					continue;
				}
				break;
			// Copilot's file editing tool is superseded by Positron's own file
			// editing tools for Positron participants.
			case 'vscode_editFile_internal':
				if (positronParticipantId) {
					continue;
				}
				break;
		}

		// Copilot tools are only included when the request uses a Copilot model.
		const copilotTool = tool.name.startsWith('copilot_');
		const usingCopilotModel = request.model.vendor === 'copilot';

		// In Ask mode, only Copilot tools tagged for code search are allowed
		// (not general Copilot tools). Adapted from Copilot Chat's askAgentIntent.
		if (copilotTool && isAskMode && !tool.tags.includes('vscode_codesearch')) {
			continue;
		}

		// Enable Copilot tools only when using a Copilot model; otherwise enable
		// in agent mode or when the tool is tagged for Positron Assistant.
		const enableTool = copilotTool
			? usingCopilotModel
			: (isAgentMode || tool.tags.includes(POSITRON_ASSISTANT_TOOL_TAG));
		if (enableTool) {
			enabledTools.push(tool.name);
		}
	}

	return enabledTools;
}
