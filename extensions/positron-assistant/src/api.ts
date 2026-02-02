/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as xml from './xml.js';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { isStreamingEditsEnabled, ParticipantID } from './participants.js';
import { hasAttachedNotebookContext, getAttachedNotebookContext, SerializedNotebookContext, isNotebookModeEnabled } from './tools/notebookUtils.js';
import { MARKDOWN_DIR, TOOL_TAG_REQUIRES_ACTIVE_SESSION, TOOL_TAG_REQUIRES_WORKSPACE, TOOL_TAG_REQUIRES_NOTEBOOK, TOOL_TAG_REQUIRES_ACTIONS } from './constants.js';
import { isWorkspaceOpen } from './utils.js';
import { PositronAssistantToolName } from './types.js';
import path = require('path');
import fs = require('fs');
import { log } from './log.js';
import { CopilotService } from './copilot.js';
import { PromptMetadataMode, PromptRenderer } from './promptRender.js';

/**
 * This is the API exposed by Positron Assistant to other extensions.
 *
 * It's used by the Copilot Chat extension to get Positron Assistant specific
 * instructions and context for embedding in Copilot prompts.
 */
export class PositronAssistantApi {

	/** The singleton instance. */
	private static _instance?: PositronAssistantApi;

	/** An emitter for sign-in events */
	private _signInEmitter = new vscode.EventEmitter<string>();

	/** Get or create the singleton instance. */
	public static get() {
		if (!PositronAssistantApi._instance) {
			PositronAssistantApi._instance = new PositronAssistantApi();
		}
		return PositronAssistantApi._instance;
	}

	/**
	 * Generates assistant prompt content.
	 *
	 * @param request The chat request to generate content for.
	 * @returns A string containing the assistant prompt content.
	 */
	public async generateAssistantPrompt(request: vscode.ChatRequest): Promise<string> {
		// Use the currently selected mode in the chat UI
		const chatMode = await positron.ai.getCurrentChatMode();
		const mode = validateChatMode(chatMode);

		// Start with the system prompt
		const activeSessions = await positron.runtime.getActiveSessions();
		const sessions = activeSessions.map(session => session.runtimeMetadata);
		const streamingEdits = isStreamingEditsEnabled();

		// Get notebook context if available
		const notebookContext = await getAttachedNotebookContext(request);

		let prompt = PromptRenderer.renderModePrompt({ mode, sessions, request, streamingEdits, notebookContext }).content;

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

	/**
	 * Called from the Assistant side to notify that a provider has signed in
	 *
	 * @param provider The provider that signed in
	 */
	public notifySignIn(provider: string) {
		log.info(`[Assistant API] Provider signed in: ${provider}`);
		this._signInEmitter.fire(provider);
	}

	/**
	 * Notifies other extensions of a sign-in event
	 *
	 * @returns The event
	 */
	public onProviderSignIn(callback: (s: string) => void): vscode.Disposable {
		return this._signInEmitter.event(callback);
	}
}

/**
 * Copilot notebook tool names that should be disabled when Positron notebook mode is active.
 * These tools conflict with Positron's specialized notebook tools.
 */
const COPILOT_NOTEBOOK_TOOLS = new Set([
	'copilot_editNotebook',
	'copilot_getNotebookSummary',
	'copilot_runNotebookCell',
	'copilot_readNotebookCellOutput',
	'copilot_createNewJupyterNotebook',
]);

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
	const disabledTools: Array<{ name: string; reason: string }> = [];

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

	// Check if a notebook is attached as context and has an active editor
	const hasActiveNotebook = hasAttachedNotebookContext(request);

	// Define more readable variables for filtering.
	const inChatPane = request.location2 === undefined;
	const inEditor = request.location2 instanceof vscode.ChatRequestEditorData;
	const hasSelection = inEditor && request.location2.selection?.isEmpty === false;
	const isEditMode = positronParticipantId === ParticipantID.Edit;
	const isAgentMode = positronParticipantId === ParticipantID.Agent ||
		positronParticipantId === undefined;
	const isAskMode = positronParticipantId === ParticipantID.Chat;
	const isStreamingInlineEditor = isStreamingEditsEnabled() &&
		(positronParticipantId === ParticipantID.Editor || positronParticipantId === ParticipantID.Notebook);

	for (const tool of tools) {
		// Check if the user has explicitly disabled this tool via the Configure Tools picker,
		// which is only available in Agent mode.
		if (isAgentMode && request.tools?.get(tool.name) === false) {
			disabledTools.push({ name: tool.name, reason: 'Was disabled via Configure Tools picker' });
			continue;
		}

		// Don't allow any tools in the terminal.
		if (positronParticipantId === ParticipantID.Terminal) {
			disabledTools.push({ name: tool.name, reason: 'Is not allowed in terminal' });
			continue;
		}

		// If streaming edits are enabled, don't allow any tools in inline editor chats.
		if (isStreamingInlineEditor) {
			disabledTools.push({ name: tool.name, reason: 'Is not allowed in inline editor with streaming edits' });
			continue;
		}

		// If the tool requires a workspace, but no workspace is open, don't allow the tool.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_WORKSPACE) && !isWorkspaceOpen()) {
			disabledTools.push({ name: tool.name, reason: 'Requires workspace but none is open' });
			continue;
		}

		// If the tool requires an active session, but no active session
		// is available, don't allow the tool.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_ACTIVE_SESSION) && activeSessions.size === 0) {
			disabledTools.push({ name: tool.name, reason: 'Requires active session but none available' });
			continue;
		}

		// If the tool requires a session to be active for a specific
		// language, but no active session is available for that
		// language, don't allow the tool.
		for (const tag of tool.tags) {
			if (tag.startsWith(TOOL_TAG_REQUIRES_ACTIVE_SESSION + ':') &&
				!activeSessions.has(tag.split(':')[1])) {
				disabledTools.push({ name: tool.name, reason: `Requires active ${tag.split(':')[1]} session` });
				continue;
			}
		}

		// If the tool requires a notebook, but no notebook is attached with active editor,
		// skip it early. Specific notebook tools have additional mode-based checks below.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_NOTEBOOK) && !(inChatPane && hasActiveNotebook)) {
			disabledTools.push({ name: tool.name, reason: 'Requires notebook but none attached or not in chat pane' });
			continue;
		}

		// If the tool requires actions, skip it in Ask mode.
		if (tool.tags.includes(TOOL_TAG_REQUIRES_ACTIONS) && isAskMode) {
			disabledTools.push({ name: tool.name, reason: 'Is not available in Ask mode' });
			continue;
		}

		// If the tool is designed for Positron Assistant but we don't have a
		// Positron assistant ID, skip it.
		if (tool.name.startsWith('positron') && positronParticipantId === undefined) {
			disabledTools.push({ name: tool.name, reason: 'Requires a Positron participant' });
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
					disabledTools.push({ name: tool.name, reason: 'Requires chat pane, console sessions, and agent mode' });
					continue;
				}
				break;
			// Notebook tools require both a notebook attached as context AND an active notebook editor.
			// Tool availability varies by mode:
			// - Execution tools (RunNotebookCells): Agent mode only
			// - Modification tools (EditNotebookCells): Edit and Agent modes
			// - Read-only tools (GetNotebookCells): All modes (Ask, Edit, Agent)
			case PositronAssistantToolName.RunNotebookCells:
				// Execution requires Agent mode
				if (!(inChatPane && hasActiveNotebook && isAgentMode)) {
					disabledTools.push({ name: tool.name, reason: 'Requires chat pane, active notebook, and agent mode' });
					continue;
				}
				break;
			case PositronAssistantToolName.EditNotebookCells:
				// Modification requires Edit or Agent mode
				// Available when notebook mode is enabled (not just when notebook is active)
				// so it can be used immediately after CreateNotebook in the same turn
				if (!(inChatPane && isNotebookModeEnabled() && (isEditMode || isAgentMode))) {
					disabledTools.push({ name: tool.name, reason: 'Requires chat pane, notebook mode, and edit/agent mode' });
					continue;
				}
				break;
			case PositronAssistantToolName.GetNotebookCells:
				// Read-only tools available in all modes when notebook mode is enabled
				// Available without active notebook so it can be used after CreateNotebook
				if (!(inChatPane && isNotebookModeEnabled())) {
					disabledTools.push({ name: tool.name, reason: 'Requires chat pane and notebook mode' });
					continue;
				}
				break;
			case PositronAssistantToolName.CreateNotebook:
				// CreateNotebook requires notebook mode enabled but NOT an active notebook
				// Only available in Edit or Agent mode (creates something)
				if (!(inChatPane && isNotebookModeEnabled() && (isEditMode || isAgentMode))) {
					disabledTools.push({ name: tool.name, reason: 'Requires chat pane, notebook mode, and edit/agent mode' });
					continue;
				}
				break;
			// Only include the documentEdit tool in an editor and if there is
			// no selection.
			case PositronAssistantToolName.DocumentEdit:
				if (!(inEditor && !hasSelection)) {
					disabledTools.push({ name: tool.name, reason: 'Requires editor context without selection' });
					continue;
				}
				break;
			// Only include the selectionEdit tool in an editor and if there is
			// a selection.
			case PositronAssistantToolName.SelectionEdit:
				if (!(inEditor && hasSelection)) {
					disabledTools.push({ name: tool.name, reason: 'Requires editor context with selection' });
					continue;
				}
				break;
			// Only include the edit file tool in edit or agent mode i.e. for the edit participant.
			case PositronAssistantToolName.EditFile:
				if (!(isEditMode || isAgentMode)) {
					disabledTools.push({ name: tool.name, reason: 'Requires edit or agent mode' });
					continue;
				}
				break;
			// Only include the documentCreate tool in the chat pane in edit or agent mode.
			case PositronAssistantToolName.DocumentCreate:
				if (!inChatPane || !(isEditMode || isAgentMode)) {
					disabledTools.push({ name: tool.name, reason: 'Requires chat pane and edit/agent mode' });
					continue;
				}
				break;
			// Only include the getTableSummary tool when there are variables available
			case PositronAssistantToolName.GetTableSummary:
				if (!hasVariables) {
					disabledTools.push({ name: tool.name, reason: 'Requires variables in session' });
					continue;
				}
				break;
			// Only include the inspectVariables tool if there are variables defined.
			case PositronAssistantToolName.InspectVariables:
				if (!hasVariables) {
					disabledTools.push({ name: tool.name, reason: 'Requires variables in session' });
					continue;
				}
				break;
			// This tool is used by Copilot to edit files; Positron Assistant
			// has its own file editing tool. Don't include this tool for
			// Positron participants.
			case 'vscode_editFile_internal':
				if (positronParticipantId) {
					disabledTools.push({ name: tool.name, reason: 'Is superseded by Positron file editing tools' });
					continue;
				}
				break;
		}

		// Check that the request is using a Copilot model.
		const usingCopilotModel = request.model.vendor === 'copilot';
		// Check if the user has opted-in to always include Copilot tools.
		const alwaysIncludeCopilotTools = vscode.workspace.getConfiguration('positron.assistant').get('alwaysIncludeCopilotTools', false);
		// Check if the tool is provided by Copilot.
		const copilotTool = tool.name.startsWith('copilot_');

		// Disable Copilot notebook tools when Positron notebook mode is active
		// to avoid conflicts with Positron's specialized notebook tools.
		if (copilotTool && COPILOT_NOTEBOOK_TOOLS.has(tool.name)) {
			// For most tools, this means an active notebook is attached
			// For createNotebook specifically, we disable when our CreateNotebook tool would be available
			if (hasActiveNotebook ||
				(tool.name === 'copilot_createNewJupyterNotebook' &&
					inChatPane && isNotebookModeEnabled() && (isEditMode || isAgentMode))) {
				disabledTools.push({ name: tool.name, reason: 'Is superseded by Positron notebook tools' });
				continue;
			}
		}

		// Check if the user is signed into Copilot.
		let copilotEnabled;
		try {
			copilotEnabled = CopilotService.instance().isSignedIn;
		} catch {
			// Ignore errors
			copilotEnabled = false;
		}
		// We should include Copilot tools if we're using a Copilot model,
		// or if the user is signed into Copilot and has opted-in to always
		// include Copilot tools.
		const shouldIncludeCopilotTools = (usingCopilotModel || copilotEnabled && alwaysIncludeCopilotTools);

		// Special filtering for Copilot tools in Ask mode.
		if (copilotTool && isAskMode && !tool.tags.includes('vscode_codesearch')) {
			// In Positron Ask mode, only include
			// Copilot tools that are tagged with 'vscode_codesearch' to allow
			// use of code search functionality but *not* general Copilot tools.

			// Adapted from extensions/positron-copilot-chat/src/extension/intents/node/askAgentIntent.ts:35
			// Possibly revisit this logic in the future as Copilot evolves.
			disabledTools.push({ name: tool.name, reason: 'Is not available in Ask mode' });
			continue;
		}

		// Enable Copilot tools only if shouldIncludeCopilotTools is true; otherwise, enable if agent mode or tool is tagged 'positron-assistant'.
		const enableTool = copilotTool
			? shouldIncludeCopilotTools
			: (isAgentMode || tool.tags.includes('positron-assistant'));

		// If we've decided to enable the tool, add it to the list.
		if (enableTool) {
			enabledTools.push(tool.name);
		} else {
			// Track why this tool was not enabled
			if (copilotTool) {
				disabledTools.push({ name: tool.name, reason: 'Requires Copilot model or opt-in' });
			} else {
				disabledTools.push({ name: tool.name, reason: 'Requires agent mode or positron-assistant tag' });
			}
		}
	}

	// Log disabled tools at trace level for debugging
	if (disabledTools.length > 0) {
		const disabledList = disabledTools.map((t, i) => `  ${i + 1}. ${t.name}: ${t.reason}`).join('\n');
		log.trace(`[tools] ${disabledTools.length} Disabled tools for participant ${positronParticipantId}:\n${disabledList}`);
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

function isEnumMember<T extends Record<string, unknown>>(
	value: unknown | undefined,
	enumObj: T
): value is T[keyof T] {
	return value !== undefined && Object.values(enumObj).includes(value);
}

function validateChatMode(mode: string | undefined): PromptMetadataMode {
	if (isEnumMember(mode, positron.PositronChatMode) || isEnumMember(mode, positron.PositronChatAgentLocation)) {
		return mode;
	}
	return positron.PositronChatMode.Agent;
}
