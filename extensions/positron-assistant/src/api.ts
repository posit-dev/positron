/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as xml from './xml.js';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { isStreamingEditsEnabled, ParticipantID } from './participants.js';
import { MARKDOWN_DIR, TOOL_TAG_REQUIRES_ACTIVE_SESSION, TOOL_TAG_REQUIRES_WORKSPACE } from './constants.js';
import { isWorkspaceOpen } from './utils.js';
import { PositronAssistantToolName } from './types.js';
import path = require('path');
import fs = require('fs');
import { log } from './extension.js';

/**
 * This is the API exposed by Positron Assistant to other extensions.
 *
 * It's used by the Copilot Chat extension to get Positron Assistant specific
 * instructions and context for embedding in Copilot prompts.
 */
export class PositronAssistantApi {
	/**
	 * Generates assistant prompt content.
	 *
	 * @param request The chat request to generate content for.
	 * @returns A string containing the assistant prompt content.
	 */
	public async generateAssistantPrompt(request: any): Promise<string> {
		// Start with the system prompt
		let prompt = fs.readFileSync(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');

		// Get the IDE context for the request.
		const positronContext = await positron.ai.getPositronChatContext(request);
		const contextPrompts = getPositronContextPrompts(positronContext);
		prompt += contextPrompts.join('\n');
		if (contextPrompts.length > 0) {
			prompt += xml.node('context', contextPrompts.join('\n\n'));
		}

		// Add context about the active sessions
		let sessionCount = 0;
		let allSessions = '';
		const allReferences = request?.references || [];
		for (const reference of allReferences) {
			const value = reference.value as any;
			if (value.activeSession) {
				const sessionSummary = JSON.stringify(value.activeSession, null, 2);
				let sessionContent = sessionSummary;
				if (value.variables) {
					// Include the session variables in the session content.
					const variablesSummary = JSON.stringify(value.variables, null, 2);
					sessionContent += '\n' + xml.node('variables', variablesSummary);
				}
				allSessions += xml.node('session', sessionContent);
				sessionCount++;
			}
		}

		if (sessionCount > 0) {
			const sessionText = fs.readFileSync(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'sessions.md'), 'utf8');
			prompt += sessionText + '\n' + xml.node('sessions', allSessions);
		}

		log.debug(`Generated Positron context for prompt (${sessionCount} sessions, ` +
			`${prompt.length} characters)`);

		return prompt;
	}

	/**
	 * Gets the set of enabled tools for a chat request.
	 *
	 * This is called by Copilot Chat to give Positron an opportunity to filter
	 * the set of tools that will be available to the model.
	 *
	 * @param request The chat request to get enabled tools for.
	 * @param tools The list of tools to filter.
	 *
	 * @returns The list of enabled tool names.
	 */
	public getEnabledTools(request: vscode.ChatRequest, tools: readonly vscode.LanguageModelToolInformation[]): Array<string> {
		return getEnabledTools(request, tools);
	}
}

/**
 * Gets the set of enabled tools for a chat request.
 *
 * @param request The chat request to get enabled tools for.
 * @param tools The list of tools to filter.
 * @param positronParticipantId The participant ID of the Positron participant,
 * if any. Undefined if being called with a non-Positron participant, such as
 * Copilot Chat.
 *
 * @returns The list of enabled tool names.
 */
export function getEnabledTools(
	request: vscode.ChatRequest,
	tools: readonly vscode.LanguageModelToolInformation[],
	positronParticipantId?: string): Array<string> {

	const enabledTools: Array<string> = [];

	// See IChatRuntimeSessionContext for the structure of the active
	// session context objects
	const activeSessions: Set<string> = new Set();
	let hasVariables = false;
	let hasConsoleSessions = false;
	const allReferences = request?.references || [];
	for (const reference of allReferences) {
		const value = reference.value as any;

		// Build a list of languages for which we have active sessions.
		if (value.activeSession) {
			activeSessions.add(value.activeSession.languageId);
			if (value.activeSession.mode === positron.LanguageRuntimeSessionMode.Console) {
				hasConsoleSessions = true;
			}
		}

		// Check if there are variables defined in the session.
		if (value.variables && value.variables.length > 0) {
			hasVariables = true;
		}
	}

	// Define more readable variables for filtering.
	const inChatPane = request.location2 === undefined;
	const inEditor = request.location2 instanceof vscode.ChatRequestEditorData;
	const hasSelection = inEditor && request.location2.selection?.isEmpty === false;
	const isEditMode = positronParticipantId === ParticipantID.Edit;
	const isAgentMode = positronParticipantId === ParticipantID.Agent ||
		positronParticipantId === undefined;
	const isStreamingInlineEditor = isStreamingEditsEnabled() &&
		(positronParticipantId === ParticipantID.Editor || positronParticipantId === ParticipantID.Notebook);

	for (const tool of tools) {
		// Don't allow any tools in the terminal.
		if (positronParticipantId === ParticipantID.Terminal) {
			continue;
		}

		// If streaming edits are enabled, don't allow any tools in inline editor chats.
		if (isStreamingInlineEditor) {
			continue;
		}

		// If the tool requires a workspace, but no workspace is open, don't allow the tool.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_WORKSPACE) && !isWorkspaceOpen()) {
			continue;
		}

		// If the tool requires an active session, but no active session
		// is available, don't allow the tool.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_ACTIVE_SESSION) && activeSessions.size === 0) {
			continue;
		}

		// If the tool requires a session to be active for a specific
		// language, but no active session is available for that
		// language, don't allow the tool.
		for (const tag of tool.tags) {
			if (tag.startsWith(TOOL_TAG_REQUIRES_ACTIVE_SESSION + ':') &&
				!activeSessions.has(tag.split(':')[1])) {
				continue;
			}
		}

		// If the tool is designed for Positron Assistant but we don't have a
		// Positron assistant ID, skip it.
		if (tool.name.startsWith('positron') && positronParticipantId === undefined) {
			continue;
		}

		switch (tool.name) {
			// Only include the execute code tool in the Chat pane; the other
			// panes do not have an affordance for confirming executions.
			//
			// CONSIDER: It would be better for us to introspect the tool itself
			// to see if it requires confirmation, but that information isn't
			// currently exposed in `vscode.LanguageModelChatTool`.
			case PositronAssistantToolName.ExecuteCode:
				// The tool can only be used with console sessions and
				// when in agent mode; it does not currently support
				// notebook mode.
				if (!(inChatPane && hasConsoleSessions && isAgentMode)) {
					continue;
				}
				break;
			// Only include the documentEdit tool in an editor and if there is
			// no selection.
			case PositronAssistantToolName.DocumentEdit:
				if (!(inEditor && !hasSelection)) {
					continue;
				}
				break;
			// Only include the selectionEdit tool in an editor and if there is
			// a selection.
			case PositronAssistantToolName.SelectionEdit:
				if (!(inEditor && hasSelection)) {
					continue;
				}
				break;
			// Only include the edit file tool in edit or agent mode i.e. for the edit participant.
			case PositronAssistantToolName.EditFile:
				if (!(isEditMode || isAgentMode)) {
					continue;
				}
				break;
			// Only include the documentCreate tool in the chat pane in edit or agent mode.
			case PositronAssistantToolName.DocumentCreate:
				if (!inChatPane || !(isEditMode || isAgentMode)) {
					continue;
				}
				break;
			// Only include the getTableSummary tool when there are variables available
			case PositronAssistantToolName.GetTableSummary:
				if (!hasVariables) {
					continue
				}
				break;
			// Only include the inspectVariables tool if there are variables defined.
			case PositronAssistantToolName.InspectVariables:
				if (!hasVariables) {
					continue;
				}
				break;
		}

		// Final check: if we're in agent mode, or the tool is marked for use with
		// Assistant, include the tool
		if (isAgentMode || tool.tags.includes('positron-assistant')) {
			enabledTools.push(tool.name);
		}
	}

	return enabledTools;
}


/**
 * Get the context prompts for the Positron Assistant.
 *
 * @param positronContext The Positron context to extract prompts from.
 * @returns An array of context prompts.
 */
export function getPositronContextPrompts(positronContext: positron.ai.ChatContext): Array<string> {
	const result: Array<string> = [];

	// Note: Runtime session information (active session, variables, execution history)
	// is now provided through IChatRequestRuntimeSessionEntry mechanism rather than
	// being included in the global positronContext. The chat system will automatically
	// include this information when available.
	if (positronContext.shell) {
		const shellNode = xml.node('shell', positronContext.shell, {
			description: 'Current active shell',
		});
		result.push(shellNode);
		log.debug(`[context] adding shell context: ${shellNode.length} characters`);
	}
	if (positronContext.plots && positronContext.plots.hasPlots) {
		const plotsNode = xml.node('plots', 'A plot is visible.');
		result.push(plotsNode);
		log.debug(`[context] adding plots context: ${plotsNode.length} characters`);
	}
	if (positronContext.positronVersion) {
		const versionNode = xml.node('version', `Positron version: ${positronContext.positronVersion}`);
		result.push(versionNode);
		log.debug(`[context] adding positron version context: ${versionNode.length} characters`);
	}
	if (positronContext.currentDate) {
		const dateNode = xml.node('date', `Today's date is: ${positronContext.currentDate}`);
		result.push(dateNode);
		log.debug(`[context] adding date context: ${dateNode.length} characters`);
	}
	return result;
}
