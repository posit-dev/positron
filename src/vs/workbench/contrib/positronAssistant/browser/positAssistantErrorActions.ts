/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ErrorActionKind, IErrorActionContext, IErrorActionsService } from '../common/errorActions.js';
import { NewChatOptions, openPositAssistantChat, POSIT_HAS_CHAT_MODELS_KEY } from './positAssistantChat.js';

/** Posit Assistant's error action handler id. */
const POSIT_ASSISTANT_ERROR_ACTIONS_ID = 'posit-assistant';

/** The Posit Assistant extension's identifier. */
const POSIT_ASSISTANT_EXTENSION_ID = 'posit.assistant';

// Appended to every notebook and Quarto Explain prompt. Without it, an agentic
// assistant treats "Explain this error" plus an attached traceback as license
// to fix it too.
const explainOnlyConstraint = localize('positronAssistantExplainOnlyConstraint', "Do not make changes or edit any files; just explain the error.");

/**
 * Registers Posit Assistant's implementation of the error Fix and Explain
 * actions while the extension is installed. It takes errors while Posit
 * Assistant has a usable chat model.
 */
export class PositAssistantErrorActionsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positAssistantErrorActions';

	/** The handler's registration, set while Posit Assistant is installed. */
	private readonly _registration = this._register(new MutableDisposable());

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IErrorActionsService private readonly _errorActionsService: IErrorActionsService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._updateRegistration();
		this._register(this._extensionService.onDidChangeExtensions(() => this._updateRegistration()));
	}

	/** Register the handler while Posit Assistant is installed, and unregister it otherwise. */
	private _updateRegistration(): void {
		const installed = this._extensionService.extensions.some(extension =>
			ExtensionIdentifier.equals(extension.identifier, POSIT_ASSISTANT_EXTENSION_ID));
		if (!installed) {
			this._registration.clear();
			return;
		}
		if (this._registration.value) {
			return;
		}

		// Set by the Posit Assistant extension when it has at least one usable
		// model (a configured cloud provider, a local provider, or a vscode.lm
		// model such as Copilot).
		this._registration.value = this._errorActionsService.register({
			id: POSIT_ASSISTANT_ERROR_ACTIONS_ID,
			label: localize('positronAssistantErrorActionsLabel', "Posit Assistant"),
			canContinueChat: true,
			when: ContextKeyExpr.has(POSIT_HAS_CHAT_MODELS_KEY),
			run: (kind, context) => openPositAssistantChat(
				this._commandService,
				this._notificationService,
				this._logService,
				getPositAssistantChatOptions(kind, context)
			),
		});
	}
}

/**
 * Build the posit-assistant.newChat request for a Fix or Explain action: a
 * prompt naming where the error came from, with the error attached.
 */
function getPositAssistantChatOptions(kind: ErrorActionKind, context: IErrorActionContext): NewChatOptions {
	const location = context.location;
	let fixPrompt: string;
	let explainPrompt: string;
	let attachmentName: string;
	let content: string;
	switch (location.kind) {
		case 'console':
			// The console's prompts have no explain-only constraint, and its
			// error output is attached verbatim.
			fixPrompt = localize('positronConsoleAssistantFixPrompt', "Fix this console error.");
			explainPrompt = localize('positronConsoleAssistantExplainPrompt', "Explain this console error.");
			attachmentName = localize('positronConsoleAssistantErrorAttachmentName', "Console Error");
			content = context.error;
			break;
		case 'notebook':
			fixPrompt = localize('positronNotebookAssistantFixPrompt', "Fix this notebook cell error.");
			explainPrompt = `${localize('positronNotebookAssistantExplainPrompt', "Explain this notebook cell error.")} ${explainOnlyConstraint}`;
			attachmentName = localize('positronNotebookAssistantErrorAttachmentName', "Notebook Cell Error");
			content = removeAnsiEscapeCodes(context.error).trim();
			break;
		case 'quarto': {
			attachmentName = localize('positronQuartoAssistantErrorAttachmentName', "Quarto Output Error");
			const chunk = location.chunk;
			if (!chunk) {
				fixPrompt = localize('positronQuartoAssistantFixPrompt', "Fix this Quarto inline output error.");
				explainPrompt = `${localize('positronQuartoAssistantExplainPrompt', "Explain this Quarto inline output error.")} ${explainOnlyConstraint}`;
				content = removeAnsiEscapeCodes(context.error).trim();
				break;
			}
			const { languageId, startLine, endLine, path, label } = chunk;
			fixPrompt = localize('positronQuartoAssistantFixPromptWithContext', "Fix the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached; fix only this error.", languageId, startLine, endLine, path);
			explainPrompt = `${localize('positronQuartoAssistantExplainPromptWithContext', "Explain the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached.", languageId, startLine, endLine, path)} ${explainOnlyConstraint}`;
			const header = label
				? localize('positronQuartoErrorContextHeaderLabeled', "Error from the {0} code chunk in {1}, lines {2}-{3} (label: {4}):", languageId, path, startLine, endLine, label)
				: localize('positronQuartoErrorContextHeader', "Error from the {0} code chunk in {1}, lines {2}-{3}:", languageId, path, startLine, endLine);
			const codeHeader = localize('positronQuartoErrorContextCodeHeader', "--- Failing code ---");
			const errorHeader = localize('positronQuartoErrorContextErrorHeader', "--- Error output ---");
			content = removeAnsiEscapeCodes(`${header}\n\n${codeHeader}\n${chunk.code}\n\n${errorHeader}\n${context.error}`).trim();
			break;
		}
	}

	return {
		prompt: kind === 'fix' ? fixPrompt : explainPrompt,
		target: context.chat === 'new' ? 'new' : 'auto',
		behavior: 'submit',
		...(content && { files: [{ uri: `data:text/plain;base64,${encodeBase64(VSBuffer.fromString(content))}`, name: attachmentName }] }),
	};
}
