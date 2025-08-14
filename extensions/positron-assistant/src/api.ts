/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PromptElement } from '@vscode/prompt-tsx';
import { PositronAssistant } from './prompts/components/content/PositronAssistant.js';

export class PositronAssistantApi {
	/**
	 * Generates assistant prompt content.
	 *
	 * The returned content should be wrapped in an AssistantMessage.
	 */
	public generateAssistantPrompt(request: any): PromptElement<any, any> {
		return new PositronAssistant({ request: request.request ? request.request : request });
	}
}
