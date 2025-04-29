/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ALL_DOCUMENTS_SELECTOR } from './constants.js';

const startEditorChatCommand = 'vscode.editorChat.start';
const openChatViewCommand = 'workbench.action.chat.open';

// Copied and renamed from positron/src/vs/workbench/api/common/extHostApiCommands.ts
interface StartEditorChatOptions {
	initialRange?: vscode.Range;
	initialSelection?: vscode.Selection;
	message?: string;
	autoSend?: boolean;
	position?: vscode.Position;
}

// Copied and renamed from positron/src/vs/workbench/contrib/chat/browser/actions/chatActions.ts
interface OpenChatViewOptions {
	/**
	 * The query for chat.
	 */
	query: string;
	/**
	 * Whether the query is partial and will await more input from the user.
	 */
	isPartialQuery?: boolean;
	/**
	 * A list of tools IDs with `canBeReferencedInPrompt` that will be resolved and attached if they exist.
	 */
	toolIds?: string[];
	/**
	 * Any previous chat requests and responses that should be shown in the chat view.
	 */
	previousRequests?: OpenChatViewRequestEntry[];
	/**
	 * Whether a screenshot of the focused window should be taken and attached
	 */
	attachScreenshot?: boolean;
	/**
	 * The mode to open the chat in.
	 */
	mode?: ChatMode;
}

// Copied from positron/src/vs/workbench/contrib/chat/common/constants.ts
enum ChatMode {
	Ask = 'ask',
	Edit = 'edit',
	Agent = 'agent'
}

// Copied and renamed from positron/src/vs/workbench/contrib/chat/browser/actions/chatActions.ts
export interface OpenChatViewRequestEntry {
	request: string;
	response: string;
}

class AssistantCodeActionProvider implements vscode.CodeActionProvider {
	metadata: vscode.CodeActionProviderMetadata = {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
	};

	async provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken,
	): Promise<(vscode.CodeAction | vscode.Command)[] | undefined> {
		// We currently only provide quickfix actions.
		// If the request is only for other action types, exit early.
		if (!context.only?.intersects(vscode.CodeActionKind.QuickFix)) {
			return undefined;
		}

		// If there are no diagnostics, exit early.
		if (context.diagnostics.length === 0) {
			return undefined;
		}

		// Create a single text message from the diagnostics.
		// This will be used in prompts to the assistant.
		const diagnosticsMessage = context.diagnostics.map(diagnostic => diagnostic.message).join('\n\n');

		// Create the fix action.
		const fixAction = new vscode.CodeAction(
			vscode.l10n.t('Fix with Assistant'),
			vscode.CodeActionKind.QuickFix,
		);

		// Setting isAI to true:
		// 1. Shows the code action in the diagnostic hover.
		// 2. Assigns the Cmd+I keyboard shortcut.
		// 3. Adds a sparkle icon in the quick fix menu.
		fixAction.isAI = true;

		// The fix action will start an editor chat session with a message
		// instructing the assistant to fix the diagnostics.
		fixAction.command = {
			title: fixAction.title,
			command: startEditorChatCommand,
			arguments: [{
				initialRange: range instanceof vscode.Range ? range : undefined,
				initialSelection: range instanceof vscode.Selection ? range : undefined,
				message: `/fix ${diagnosticsMessage}`,
				// Send the message immediately.
				autoSend: true,
				position: range.start,
			} satisfies StartEditorChatOptions],
		};

		// Create the explain action.
		const explainAction = new vscode.CodeAction(
			vscode.l10n.t('Explain with Assistant'),
			vscode.CodeActionKind.QuickFix,
		);

		// See above for an explanation of isAI.
		explainAction.isAI = true;

		// The explain action will open the (global) chat view with a message
		// instructing the assistant to explain the diagnostics.
		explainAction.command = {
			title: explainAction.title,
			command: openChatViewCommand,
			arguments: [{
				query: `/explain ${diagnosticsMessage}`,
				// Send the message immediately.
				isPartialQuery: false,
				mode: ChatMode.Ask,
			} satisfies OpenChatViewOptions],
		};

		return [
			fixAction,
			explainAction,
		];
	}
}

export function registerCodeActionProvider(context: vscode.ExtensionContext) {
	const codeActionsProvider = new AssistantCodeActionProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			ALL_DOCUMENTS_SELECTOR,
			codeActionsProvider,
			codeActionsProvider.metadata,
		)
	);
}
