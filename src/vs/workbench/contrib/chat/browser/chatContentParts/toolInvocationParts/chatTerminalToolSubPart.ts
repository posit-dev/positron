/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { thenIfNotDisposed } from '../../../../../../base/common/lifecycle.js';
import { MarkdownRenderer } from '../../../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { localize } from '../../../../../../nls.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ChatContextKeys } from '../../../common/chatContextKeys.js';
import { IChatTerminalToolInvocationData, IChatToolInvocation } from '../../../common/chatService.js';
import { CancelChatActionId } from '../../actions/chatExecuteActions.js';
import { AcceptToolConfirmationActionId } from '../../actions/chatToolActions.js';
import { IChatCodeBlockInfo, IChatWidgetService } from '../../chat.js';
import { ICodeBlockRenderOptions } from '../../codeBlockPart.js';
import { ChatCustomConfirmationWidget, IChatConfirmationButton } from '../chatConfirmationWidget.js';
import { IChatContentPartRenderContext } from '../chatContentParts.js';
import { EditorPool } from '../chatMarkdownContentPart.js';
import { BaseChatToolInvocationSubPart } from './chatToolInvocationSubPart.js';

// --- Start Positron ---
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
// --- End Positron ---
export class TerminalConfirmationWidgetSubPart extends BaseChatToolInvocationSubPart {
	public readonly domNode: HTMLElement;
	public readonly codeblocks: IChatCodeBlockInfo[] = [];

	constructor(
		toolInvocation: IChatToolInvocation,
		terminalData: IChatTerminalToolInvocationData,
		private readonly context: IChatContentPartRenderContext,
		private readonly renderer: MarkdownRenderer,
		private readonly editorPool: EditorPool,
		private readonly currentWidthDelegate: () => number,
		private readonly codeBlockStartIndex: number,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super(toolInvocation);

		if (!toolInvocation.confirmationMessages) {
			throw new Error('Confirmation messages are missing');
		}

		const title = toolInvocation.confirmationMessages.title;
		const message = toolInvocation.confirmationMessages.message;
		// --- Start Positron ---
		// Show a clearer message for code to be executed in the Console
		// const continueLabel = localize('continue', "Continue");
		const continueLabel = localize('runInConsole', "Run Code");
		// --- End Positron ---
		const continueKeybinding = keybindingService.lookupKeybinding(AcceptToolConfirmationActionId)?.getLabel();
		const continueTooltip = continueKeybinding ? `${continueLabel} (${continueKeybinding})` : continueLabel;
		const cancelLabel = localize('cancel', "Cancel");
		const cancelKeybinding = keybindingService.lookupKeybinding(CancelChatActionId)?.getLabel();
		const cancelTooltip = cancelKeybinding ? `${cancelLabel} (${cancelKeybinding})` : cancelLabel;

		const buttons: IChatConfirmationButton[] = [
			{
				label: continueLabel,
				data: true,
				tooltip: continueTooltip
			},
			{
				label: cancelLabel,
				data: false,
				isSecondary: true,
				tooltip: cancelTooltip
			}];
		const renderedMessage = this._register(this.renderer.render(
			typeof message === 'string' ? new MarkdownString(message) : message,
			{ asyncRenderCallback: () => this._onDidChangeHeight.fire() }
		));
		const codeBlockRenderOptions: ICodeBlockRenderOptions = {
			// --- Start Positron ---
			// Don't hide the toolbar on code blocks, so the user can still
			// copy/integrate the code elsewhere
			// hideToolbar: true,
			hideToolbar: false,
			// --- Start Positron ---
			reserveWidth: 19,
			verticalPadding: 5,
			editorOptions: {
				wordWrap: 'on',
				readOnly: false,
				tabFocusMode: true,
				ariaLabel: typeof title === 'string' ? title : title.value
			}
		};
		const langId = this.languageService.getLanguageIdByLanguageName(terminalData.language ?? 'sh') ?? 'shellscript';
		// --- Start Positron ---
		// Pass a resource with a custom scheme so that language packs can ignore these code blocks.
		// See: https://github.com/posit-dev/positron/issues/7750.
		/*
		const model = this.modelService.createModel(terminalData.command, this.languageService.createById(langId), undefined, true);
		*/
		const resource = URI.from({
			scheme: 'assistant-code-confirmation-widget',
			path: generateUuid(),
		});
		const model = this.modelService.createModel(terminalData.command, this.languageService.createById(langId), resource, true);
		// --- End Positron ---
		const editor = this._register(this.editorPool.get());
		const renderPromise = editor.object.render({
			codeBlockIndex: this.codeBlockStartIndex,
			codeBlockPartIndex: 0,
			element: this.context.element,
			languageId: langId,
			renderOptions: codeBlockRenderOptions,
			textModel: Promise.resolve(model),
			chatSessionId: this.context.element.sessionId
		}, this.currentWidthDelegate());
		this._register(thenIfNotDisposed(renderPromise, () => this._onDidChangeHeight.fire()));
		this.codeblocks.push({
			codeBlockIndex: this.codeBlockStartIndex,
			codemapperUri: undefined,
			elementId: this.context.element.id,
			focus: () => editor.object.focus(),
			isStreaming: false,
			ownerMarkdownPartId: this.codeblocksPartId,
			uri: model.uri,
			uriPromise: Promise.resolve(model.uri),
			chatSessionId: this.context.element.sessionId
		});
		this._register(editor.object.onDidChangeContentHeight(() => {
			editor.object.layout(this.currentWidthDelegate());
			this._onDidChangeHeight.fire();
		}));
		this._register(model.onDidChangeContent(e => {
			terminalData.command = model.getValue();
		}));
		const element = dom.$('');
		dom.append(element, editor.object.element);
		dom.append(element, renderedMessage.element);
		const confirmWidget = this._register(this.instantiationService.createInstance(
			ChatCustomConfirmationWidget,
			title,
			undefined,
			element,
			buttons,
			this.context.container,
		));

		ChatContextKeys.Editing.hasToolConfirmation.bindTo(this.contextKeyService).set(true);
		this._register(confirmWidget.onDidClick(button => {
			toolInvocation.confirmed.complete(button.data);
			this.chatWidgetService.getWidgetBySessionId(this.context.element.sessionId)?.focusInput();
		}));
		this._register(confirmWidget.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		toolInvocation.confirmed.p.then(() => {
			ChatContextKeys.Editing.hasToolConfirmation.bindTo(this.contextKeyService).set(false);
			this._onNeedsRerender.fire();
		});
		this.domNode = confirmWidget.domNode;
	}
}
