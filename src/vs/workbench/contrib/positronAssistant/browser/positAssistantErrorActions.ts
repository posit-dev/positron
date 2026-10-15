/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ErrorActionKind, IErrorActionContext, IErrorActionsService, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';
import { NewChatOptions, openPositAssistantChat } from './positAssistantChat.js';

// Appended to every notebook and Quarto Explain prompt. Without it, an agentic
// assistant treats "Explain this error" plus an attached traceback as license
// to fix it too.
const explainOnlyConstraint = localize('positronAssistantExplainOnlyConstraint', "Do not make changes or edit any files; just explain the error.");

/** Registers Posit Assistant's implementation of the error Fix and Explain actions. */
export class PositAssistantErrorActionsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positAssistantErrorActions';

	constructor(
		@ICommandService commandService: ICommandService,
		@IErrorActionsService errorActionsService: IErrorActionsService,
		@ILogService logService: ILogService,
		@INotificationService notificationService: INotificationService,
	) {
		super();

		this._register(errorActionsService.register({
			id: POSIT_ASSISTANT_ERROR_ACTIONS_ID,
			run: (kind, context) => openPositAssistantChat(
				commandService,
				notificationService,
				logService,
				getPositAssistantChatOptions(kind, context)
			),
		}));
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
