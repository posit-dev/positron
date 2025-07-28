/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PromptElement } from '@vscode/prompt-tsx';
import { DefaultContent } from './prompts/index.js';

export class PositronAssistantApi {
	public generateAssistantPrompt(request: vscode.ChatRequest): PromptElement {
		return new DefaultContent({});
	}
}
