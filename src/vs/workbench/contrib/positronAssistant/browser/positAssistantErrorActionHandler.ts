/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { assertNever } from '../../../../base/common/assert.js';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ErrorAction, IErrorActionContext, IErrorActionOptions, IErrorActionHandlerService } from '../common/errorAction.js';
import { DEFAULT_ERROR_ACTION_HANDLER_LABEL } from '../common/positronAIConfiguration.js';
import { POSIT_ASSISTANT_ERROR_ACTION_HANDLER_ID } from '../common/positronAIConfigurationKeys.js';
import { NewChatOptions, POSIT_HAS_CHAT_MODELS_KEY, POSIT_NEW_CHAT_COMMAND } from './positAssistantChat.js';

/** The Posit Assistant extension's identifier. */
const POSIT_ASSISTANT_EXTENSION_ID = 'posit.assistant';

/**
 * Registers Posit Assistant as an error action handler while it can take errors:
 * while the extension is installed and enabled and has a usable chat model.
 * The `ai.errorActions.agent` setting lists it either way, since it's the default.
 */
export class PositAssistantErrorActionHandlerContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positAssistantErrorActionHandler';

	/** The handler's registration, set while Posit Assistant can take errors. */
	private readonly _registration = this._register(new MutableDisposable());

	private readonly _hasChatModelsKeys = new Set([POSIT_HAS_CHAT_MODELS_KEY]);

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IErrorActionHandlerService private readonly _errorActionHandlerService: IErrorActionHandlerService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILabelService private readonly _labelService: ILabelService,
	) {
		super();

		this._updateRegistration();
		this._register(this._extensionService.onDidChangeExtensions(() => this._updateRegistration()));
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(this._hasChatModelsKeys)) {
				this._updateRegistration();
			}
		}));
	}

	/** Register the handler while Posit Assistant can take errors, and unregister it otherwise. */
	private _updateRegistration(): void {
		const installed = this._extensionService.extensions.some(extension =>
			ExtensionIdentifier.equals(extension.identifier, POSIT_ASSISTANT_EXTENSION_ID));
		// Set by the Posit Assistant extension when it has at least one usable
		// model (a configured cloud provider, a local provider, or a vscode.lm
		// model such as Copilot).
		const hasChatModels = this._contextKeyService.getContextKeyValue<boolean>(POSIT_HAS_CHAT_MODELS_KEY) === true;
		if (!installed || !hasChatModels) {
			this._registration.clear();
			return;
		}
		if (this._registration.value) {
			return;
		}

		this._registration.value = this._errorActionHandlerService.register({
			id: POSIT_ASSISTANT_ERROR_ACTION_HANDLER_ID,
			label: DEFAULT_ERROR_ACTION_HANDLER_LABEL,
			supportsChatContinuation: true,
			ask: async (action, context, options) => {
				const pathLabel = (uri: URI) => this._labelService.getUriLabel(uri, { relative: true });
				await this._commandService.executeCommand(POSIT_NEW_CHAT_COMMAND, getPositAssistantChatOptions(action, context, options, pathLabel));
			},
		});
	}
}

/**
 * Build the posit-assistant.newChat request for a Fix or Explain action: a
 * prompt naming where the error came from, with the error attached.
 * @param pathLabel Formats a document's URI for the prompt.
 */
export function getPositAssistantChatOptions(
	action: ErrorAction,
	context: IErrorActionContext,
	options: IErrorActionOptions,
	pathLabel: (uri: URI) => string,
): NewChatOptions {
	let fixPrompt: string;
	let explainPrompt: string;
	let attachmentName: string;
	let content: string;
	switch (context.kind) {
		case 'console':
			// The console's error output is attached verbatim.
			fixPrompt = localize('positronConsoleAssistantFixPrompt', "Fix this console error.");
			explainPrompt = localize('positronConsoleAssistantExplainPrompt', "Explain this console error.");
			attachmentName = localize('positronConsoleAssistantErrorAttachmentName', "Console Error");
			content = context.error;
			break;
		case 'notebook':
			fixPrompt = localize('positronNotebookAssistantFixPrompt', "Fix this notebook cell error.");
			explainPrompt = localize('positronNotebookAssistantExplainPrompt', "Explain this notebook cell error.");
			attachmentName = localize('positronNotebookAssistantErrorAttachmentName', "Notebook Cell Error");
			content = context.error.trim();
			break;
		case 'quarto': {
			attachmentName = localize('positronQuartoAssistantErrorAttachmentName', "Quarto Output Error");
			const cell = context.cell;
			if (!cell) {
				fixPrompt = localize('positronQuartoAssistantFixPrompt', "Fix this Quarto inline output error.");
				explainPrompt = localize('positronQuartoAssistantExplainPrompt', "Explain this Quarto inline output error.");
				content = context.error.trim();
				break;
			}
			const { languageId, startLine, endLine, label } = cell;
			const path = pathLabel(context.uri);
			fixPrompt = localize('positronQuartoAssistantFixPromptWithContext', "Fix the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached; fix only this error.", languageId, startLine, endLine, path);
			explainPrompt = localize('positronQuartoAssistantExplainPromptWithContext', "Explain the error from the {0} code chunk at lines {1}-{2} of {3}. The failing code and its error output are attached.", languageId, startLine, endLine, path);
			const header = label
				? localize('positronQuartoErrorContextHeaderLabeled', "Error from the {0} code chunk in {1}, lines {2}-{3} (label: {4}):", languageId, path, startLine, endLine, label)
				: localize('positronQuartoErrorContextHeader', "Error from the {0} code chunk in {1}, lines {2}-{3}:", languageId, path, startLine, endLine);
			const codeHeader = localize('positronQuartoErrorContextCodeHeader', "--- Failing code ---");
			const errorHeader = localize('positronQuartoErrorContextErrorHeader', "--- Error output ---");
			content = `${header}\n\n${codeHeader}\n${cell.code}\n\n${errorHeader}\n${context.error}`.trim();
			break;
		}
		default:
			assertNever(context);
	}

	return {
		// Without the constraint, an agentic assistant treats "Explain this
		// error" plus an attached traceback as license to fix it too.
		prompt: action === 'fix'
			? fixPrompt
			: localize('positronAssistantExplainOnlyPrompt', "{0} Do not make changes or edit any files; just explain the error.", explainPrompt),
		target: options.continueChat ? 'auto' : 'new',
		behavior: 'submit',
		...(content && { files: [{ uri: `data:text/plain;base64,${encodeBase64(VSBuffer.fromString(content))}`, name: attachmentName }] }),
	};
}
