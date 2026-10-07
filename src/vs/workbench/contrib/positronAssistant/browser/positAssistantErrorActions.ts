/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ErrorActionKind, IErrorActionContext, IErrorActionsService, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';
import { POSIT_ASSISTANT_ERROR_ACTIONS_LABEL } from './errorActionsService.js';
import { NewChatOptions, POSIT_HAS_CHAT_MODELS_KEY, POSIT_NEW_CHAT_COMMAND } from './positAssistantChat.js';

/** Identifier of the Posit Assistant extension. */
const POSIT_ASSISTANT_EXTENSION_ID = 'posit.assistant';

// Appended to every Explain prompt. Without it, an agentic assistant treats
// "Explain this error" plus an attached traceback as license to fix it too.
const explainOnlyConstraint = localize('positronAssistantExplainOnlyConstraint', "Do not make changes or edit any files; just explain the error.");

/**
 * Posit Assistant's implementation of the error Fix and Explain actions,
 * registered while the extension is installed and has a usable chat model.
 * It uses only what the `positron.ai.registerErrorActionHandler` API offers
 * an extension, so it could move into Posit Assistant.
 */
export class PositAssistantErrorActionsContribution extends Disposable implements IWorkbenchContribution {
	/** The registration, while Posit Assistant can take errors. */
	private readonly _registration = this._register(new MutableDisposable());

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IErrorActionsService private readonly _errorActionsService: IErrorActionsService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILabelService private readonly _labelService: ILabelService,
	) {
		super();

		this._updateRegistration();
		const keys = new Set([POSIT_HAS_CHAT_MODELS_KEY]);
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(keys)) {
				this._updateRegistration();
			}
		}));
		this._register(this._extensionService.onDidChangeExtensions(() => this._updateRegistration()));
	}

	/** Register while Posit Assistant is installed and has a usable chat model. */
	private _updateRegistration(): void {
		const key = ExtensionIdentifier.toKey(POSIT_ASSISTANT_EXTENSION_ID);
		const available = this._contextKeyService.getContextKeyValue<boolean>(POSIT_HAS_CHAT_MODELS_KEY) === true &&
			this._extensionService.extensions.some(extension => ExtensionIdentifier.toKey(extension.identifier) === key);
		if (!available) {
			this._registration.clear();
		} else if (!this._registration.value) {
			this._registration.value = this._errorActionsService.register({
				id: POSIT_ASSISTANT_ERROR_ACTIONS_ID,
				label: POSIT_ASSISTANT_ERROR_ACTIONS_LABEL,
				canContinueChat: true,
				run: async (kind, context) => {
					const getPath = (uri: URI) => this._labelService.getUriLabel(uri, { relative: true });
					await this._commandService.executeCommand(POSIT_NEW_CHAT_COMMAND, getPositAssistantChatOptions(kind, context, getPath));
				},
			});
		}
	}
}

/**
 * Build the posit-assistant.newChat request for a Fix or Explain action: a
 * prompt naming where the error came from, with the failing code and the
 * error attached.
 * @param getPath Resolves a document URI to the path named in the prompt.
 */
export function getPositAssistantChatOptions(
	kind: ErrorActionKind,
	context: IErrorActionContext,
	getPath: (uri: URI) => string,
): NewChatOptions {
	const location = context.location;
	let fixPrompt: string;
	let explainPrompt: string;
	let attachmentName: string;
	// A header and code are attached above the error when the code is known.
	let header: string | undefined;
	let code: string | undefined;
	switch (location?.kind) {
		case 'console':
			fixPrompt = localize('positronConsoleAssistantFixPrompt', "Fix this console error.");
			explainPrompt = localize('positronConsoleAssistantExplainPrompt', "Explain this console error.");
			attachmentName = localize('positronConsoleAssistantErrorAttachmentName', "Console Error");
			break;
		case 'notebook': {
			attachmentName = localize('positronNotebookAssistantErrorAttachmentName', "Notebook Cell Error");
			if (location.cellIndex === undefined || location.code === undefined) {
				fixPrompt = localize('positronNotebookAssistantFixPrompt', "Fix this notebook cell error.");
				explainPrompt = localize('positronNotebookAssistantExplainPrompt', "Explain this notebook cell error.");
				break;
			}
			const cellNumber = location.cellIndex + 1;
			const path = getPath(URI.revive(location.uri));
			fixPrompt = localize('positronNotebookAssistantFixPromptWithContext', "Fix the error from cell {0} of {1}. The failing code and its error output are attached; fix only this error.", cellNumber, path);
			explainPrompt = localize('positronNotebookAssistantExplainPromptWithContext', "Explain the error from cell {0} of {1}. The failing code and its error output are attached.", cellNumber, path);
			header = localize('positronNotebookErrorContextHeader', "Error from cell {0} of {1}:", cellNumber, path);
			code = location.code;
			break;
		}
		case 'quarto': {
			const { languageId, startLine, endLine, label } = location;
			const path = getPath(URI.revive(location.uri));
			attachmentName = localize('positronQuartoAssistantErrorAttachmentName', "Quarto Output Error");
			fixPrompt = localize('positronQuartoAssistantFixPromptWithContext', "Fix the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached; fix only this error.", languageId, startLine, endLine, path);
			explainPrompt = localize('positronQuartoAssistantExplainPromptWithContext', "Explain the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached.", languageId, startLine, endLine, path);
			header = label
				? localize('positronQuartoErrorContextHeaderLabeled', "Error from the {0} code chunk in {1}, lines {2}-{3} (label: {4}):", languageId, path, startLine, endLine, label)
				: localize('positronQuartoErrorContextHeader', "Error from the {0} code chunk in {1}, lines {2}-{3}:", languageId, path, startLine, endLine);
			code = location.code;
			break;
		}
		case undefined:
			fixPrompt = localize('positronAssistantFixPrompt', "Fix this error.");
			explainPrompt = localize('positronAssistantExplainPrompt', "Explain this error.");
			attachmentName = localize('positronAssistantErrorAttachmentName', "Error");
			break;
	}

	const content = header !== undefined && code !== undefined
		? [
			header,
			'',
			localize('positronAssistantErrorContextCodeHeader', "--- Failing code ---"),
			code,
			'',
			localize('positronAssistantErrorContextErrorHeader', "--- Error output ---"),
			context.error,
		].join('\n')
		: context.error;
	return {
		prompt: kind === 'fix' ? fixPrompt : `${explainPrompt} ${explainOnlyConstraint}`,
		target: context.chat === 'current' ? 'auto' : 'new',
		behavior: 'submit',
		...(content && { files: [{ uri: `data:text/plain;base64,${encodeBase64(VSBuffer.fromString(content))}`, name: attachmentName }] }),
	};
}
