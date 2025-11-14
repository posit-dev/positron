/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { IMarkdownRenderer } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IChatMarkdownContent, IChatToolInvocation, IChatToolInvocationSerialized } from '../../../common/chatService.js';
import { CodeBlockModelCollection } from '../../../common/codeBlockModelCollection.js';
import { IChatCodeBlockInfo } from '../../chat.js';
import { ICodeBlockRenderOptions } from '../../codeBlockPart.js';
import { IChatContentPartRenderContext } from '../chatContentParts.js';
import { ChatMarkdownContentPart, EditorPool } from '../chatMarkdownContentPart.js';
import { ChatProgressSubPart } from '../chatProgressContentPart.js';
import { BaseChatToolInvocationSubPart } from './chatToolInvocationSubPart.js';


/**
 * A chat content part for rendering a tool invocation with Markdown content with rich code blocks.
 * Logic adapted from the ChatTerminalMarkdownProgressPart, removing terminal-specific logic. That
 * class was later renamed to ChatTerminalToolProgressPart.
 */
export class ChatToolMarkdownProgressPart extends BaseChatToolInvocationSubPart {
	public readonly domNode: HTMLElement;

	private markdownPart: ChatMarkdownContentPart | undefined;
	public get codeblocks(): IChatCodeBlockInfo[] {
		return this.markdownPart?.codeblocks ?? [];
	}

	constructor(
		toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized,
		context: IChatContentPartRenderContext,
		renderer: IMarkdownRenderer,
		editorPool: EditorPool,
		currentWidthDelegate: () => number,
		codeBlockStartIndex: number,
		codeBlockModelCollection: CodeBlockModelCollection,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(toolInvocation);

		const content = toolInvocation.invocationMessage;
		const chatMarkdownContent: IChatMarkdownContent = {
			kind: 'markdownContent',
			content: typeof content === 'string' ? new MarkdownString(content) : content,
		};

		const codeBlockRenderOptions: ICodeBlockRenderOptions = {
			hideToolbar: toolInvocation.toolId !== 'executeCode',
			reserveWidth: 19,
			verticalPadding: 5,
			editorOptions: {
				wordWrap: 'on'
			}
		};
		this.markdownPart = this._register(instantiationService.createInstance(ChatMarkdownContentPart, chatMarkdownContent, context, editorPool, false, codeBlockStartIndex, renderer, /* markdownRenderOptions */ undefined, currentWidthDelegate(), codeBlockModelCollection, { codeBlockRenderOptions }));
		this._register(this.markdownPart.onDidChangeHeight(() => this._onDidChangeHeight.fire()));

		// Determine icon based on tool invocation state
		let icon: ThemeIcon;
		if ('state' in toolInvocation && typeof toolInvocation.state === 'object') {
			// IChatToolInvocation with state observable
			const state = toolInvocation.state.get();
			if (state.type === IChatToolInvocation.StateKind.Completed) {
				icon = Codicon.check;
			} else if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation) {
				icon = Codicon.error;
			} else {
				icon = ThemeIcon.modify(Codicon.loading, 'spin');
			}
		} else {
			// IChatToolInvocationSerialized - assume completed
			icon = Codicon.check;
		}

		const progressPart = instantiationService.createInstance(ChatProgressSubPart, this.markdownPart.domNode, icon, undefined);
		this.domNode = progressPart.domNode;
	}
}
