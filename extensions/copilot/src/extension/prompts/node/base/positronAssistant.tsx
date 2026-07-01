/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement, PromptSizing, SystemMessage, TextChunk } from '@vscode/prompt-tsx';
import type { ChatResponsePart } from '@vscode/prompt-tsx/dist/base/vscodeTypes.js';
import * as vscode from 'vscode';
import type { GenericBasePromptElementProps } from '../../../context/node/resolvers/genericPanelIntentInvocation';
import type { IBuildPromptContext } from '../../../prompt/common/intents.js';

/**
 * The Positron Assistant component; adds context from Positron as a prompt
 * element for embedding in Copilot Chat's prompt-tsx prompts
 */
export class PositronAssistant extends PromptElement<GenericBasePromptElementProps, any> {
	private readonly context: IBuildPromptContext;

	constructor(props: GenericBasePromptElementProps) {
		super(props);
		this.context = props.promptContext as IBuildPromptContext;
	}

	override async prepare(sizing: PromptSizing,
		progress?: vscode.Progress<ChatResponsePart>,
		token?: vscode.CancellationToken): Promise<any> {

		// The Positron Assistant extension supplies the Positron-specific context
		// for this prompt. When Copilot Chat is used on its own, that extension may
		// be disabled or not installed; skip this element in that case rather than
		// failing the whole chat request.
		const extension = vscode.extensions.getExtension('positron.positron-assistant');
		if (!extension) {
			return undefined;
		}

		// Activate the extension if needed so its API is available, then generate
		// the content element.
		const api = await extension.activate();
		if (typeof api?.generateAssistantPrompt !== 'function') {
			return undefined;
		}
		return await api.generateAssistantPrompt(this.context.request);
	}

	/**
	 * Renders the component.
	 *
	 * @param state The current state of the component; this is the Positron
	 * prompt returned by prepare()
	 * @param sizing The sizing information for the component.
	 *
	 * @returns The rendered component.
	 */
	render(state: any, sizing: PromptSizing) {
		// No Positron context available (e.g. the Positron Assistant extension is
		// not installed or enabled); render nothing.
		if (!state) {
			return undefined;
		}
		return (
			<SystemMessage>
				<TextChunk>{state}</TextChunk>
			</SystemMessage>
		);
	}
}
