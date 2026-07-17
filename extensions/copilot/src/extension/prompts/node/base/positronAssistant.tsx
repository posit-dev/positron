/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement, PromptSizing, SystemMessage, TextChunk } from '@vscode/prompt-tsx';
import type { ChatResponsePart } from '@vscode/prompt-tsx/dist/base/vscodeTypes.js';
import type * as vscode from 'vscode';
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

		const request = this.context.request;
		if (!request) {
			return undefined;
		}

		// Positron supplies the Positron-specific context for this prompt via the
		// `positron` API, provided by the Positron extension host at runtime. It
		// is absent when Copilot Chat runs outside Positron (or in simulation
		// tests), so guard the lookup and skip this element rather than failing
		// the whole chat request.
		try {
			const positron = require('positron') as typeof import('positron');
			return await positron.ai.generateAssistantPrompt(request);
		} catch {
			return undefined;
		}
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
