/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';

import { z } from 'zod';
import { padBase64String } from './utils';

export interface PositronToolAdapter {
	toolData: vscode.LanguageModelChatTool;
	provideAiTool(token: unknown, toolOptions: unknown): ai.Tool<any, string>;
}

export const getPlotToolAdapter: PositronToolAdapter = {
	toolData: {
		name: 'getPlot',
		description: 'Get the current visible plot.',
	},

	provideAiTool(token: unknown, options: { model: ai.LanguageModelV1; signal: AbortSignal }): ai.Tool {
		const push = (part: vscode.ChatResponsePart) => positron.ai.responseProgress(token, part);

		return ai.tool({
			description: this.toolData.description,
			parameters: z.object({}),
			execute: async () => {
				push(new vscode.ChatResponseProgressPart('Getting the current plot...'));
				const uri = await positron.ai.getCurrentPlotUri();
				const matches = uri?.match(/^data:([^;]+);base64,(.+)$/);
				if (!matches || !uri) {
					return 'No plot visible';
				}

				push(new vscode.ChatResponseProgressPart('Analysing the plot image data...'));

				// Ask the model to describe the image in a new sub-conversation behind the scenes
				const result = await ai.generateText({
					model: options.model,
					system: 'Describe the image provided by the user.',
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'text' as const,
									text: 'The image is attached.'
								}, {
									type: 'image' as const,
									mimeType: matches[1],
									image: padBase64String(matches[2]),
								}
							],
						}
					],
					abortSignal: options.signal,
				});

				return result.text;
			},
		});
	}
};

export const textEditToolAdapter: PositronToolAdapter = {
	toolData: {
		name: 'textEdit',
		description: 'Output an edited version of the code selection.',
	},

	provideAiTool(token: unknown, options: { document: vscode.TextDocument; selection: vscode.Selection }): ai.Tool {
		return ai.tool({
			description: this.toolData.description,
			parameters: z.object({
				code: z.string().describe('The entire edited code selection.'),
			}),
			execute: async ({ code }) => {
				positron.ai.responseProgress(
					token,
					new vscode.ChatResponseTextEditPart(
						options.document.uri,
						vscode.TextEdit.replace(options.selection, code)
					)
				);

				return '';
			},
		});
	}
};

export const positronToolAdapters: Record<string, PositronToolAdapter> = {
	[getPlotToolAdapter.toolData.name]: getPlotToolAdapter,
	[textEditToolAdapter.toolData.name]: textEditToolAdapter,
};

