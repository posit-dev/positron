/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement, PromptSizing, SystemMessage, TextChunk } from '@vscode/prompt-tsx';
import { ChatResponsePart } from '@vscode/prompt-tsx/dist/base/vscodeTypes.js';
import * as vscode from 'vscode';
import { GenericBasePromptElementProps } from '../../../context/node/resolvers/genericPanelIntentInvocation';
import { IBuildPromptContext } from '../../../prompt/common/intents.js';

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

		// Get the Positron API
		const api = vscode.extensions.getExtension('positron.positron-assistant')?.exports;

		// Generate the content element
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
		return (
			<SystemMessage>
				<TextChunk>{state}</TextChunk>
			</SystemMessage>
		);
	}
}
