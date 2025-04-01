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

				// Get the current plot image data
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

/**
 * A tool adapter for document edits. This tool is provided when the user uses
 * inline chat without a selection.
 */
export const documentEditToolAdapter: PositronToolAdapter = {
	toolData: {
		name: 'documentEdit',
		description: 'Output an edited version of the document.',
	},

	provideAiTool(
		token: unknown,
		options: {
			// The URI of the document to edit; we can't pass the whole `document` in
			// because the tool options are serialized, so only plain JSON is supported.
			documentUri: string,

			// The active selection, if any
			selection: vscode.Selection
		}): ai.Tool {
		return ai.tool({
			description: this.toolData.description,
			parameters: z.object({
				deltas: z.array(
					z.object({
						delete: z.string().optional().describe('Text to delete from the document.'),
						replace: z.string().optional().describe('Text to replace the deleted text.')
					})).describe('The array of changes to apply.')
			}),
			execute: async (params) => {
				// Get the text of the document to edit
				const document =
					await vscode.workspace.openTextDocument(vscode.Uri.parse(options.documentUri));
				const documentText = document.getText();

				// Process each change, emitting text edits for each one
				for (const delta of params.deltas) {
					if ('delete' in delta && 'replace' in delta) {
						const deleteText = delta.delete;
						const startPos = documentText.indexOf(deleteText!);
						if (startPos === -1) {
							// If the delete text is not found in the document,
							// we can't apply this edit; ignore.
							continue;
						}
						const startPosition = document.positionAt(startPos);
						const endPosition = document.positionAt(startPos + deleteText!.length);
						const range = new vscode.Range(startPosition, endPosition);
						const textEdit = vscode.TextEdit.replace(range, delta.replace!);
						positron.ai.responseProgress(token,
							new vscode.ChatResponseTextEditPart(
								document.uri,
								textEdit
							));
					}
				}
			}
		});
	}
};

/**
 * A tool adapter for selection edits.
 */
export const selectionEditToolAdapter: PositronToolAdapter = {
	toolData: {
		name: 'selectionEdit',
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
	[documentEditToolAdapter.toolData.name]: documentEditToolAdapter,
	[selectionEditToolAdapter.toolData.name]: selectionEditToolAdapter,
};

/**
 * Registers tools for the Positron Assistant.
 *
 * @param context The extension context for registering disposables
 */
export function registerAssistantTools(context: vscode.ExtensionContext): void {
	const executeCodeTool = vscode.lm.registerTool<{ code: string, language: string }>('executeCode', {
		/**
		 * Called by Positron to prepare for tool invocation. We use this hook
		 * to show the user the code that we are about to run, and ask for
		 * confirmation.
		 *
		 * @param options The options for the tool invocation
		 * @param token A cancellation token
		 *
		 * @returns A vscode.PreparedToolInvocation object
		 */
		prepareInvocation: async (options, token) => {

			// Ask user for confirmation before proceeding
			const result: vscode.PreparedToolInvocation = {
				/// The message shown when the code is actually executing.
				/// Positron appends '...' to this message.
				invocationMessage: vscode.l10n.t('Running'),

				/// The message shown to confirm that the user wants to run the code.
				confirmationMessages: {
					title: vscode.l10n.t('Execute Code'),
					/// Generate a MarkdownString to show the code with syntax
					/// highlighting
					message: new vscode.MarkdownString(
						'```' + options.input.language + '\n' +
						options.input.code + '\n' +
						'```'),
				}
			};
			return result;
		},

		/**
		 * Called by Positron to execute the tool and thus the code.
		 *
		 * @param options The options for the tool invocation.
		 * @param token The cancellation token.
		 *
		 * @returns A vscode.LanguageModelToolResult.
		 */
		invoke: async (options, token) => {
			/** The accumulated output text */
			let outputText: string = '';

			/** The accumulated error text */
			let outputError: string = '';

			/** The execution result, as a map of MIME types to values */
			const result: Record<string, any> = {};

			/** The execution observer */
			const observer: positron.runtime.ExecutionObserver = {
				token,
				onOutput: (output) => {
					outputText += output;
				},
				onError: (error) => {
					outputError += error;
				}
			};

			// Convert the language name into a language id
			// Consider: works okay for R and Python but may not work for
			// all languages
			const languageId = options.input.language.toLowerCase();
			try {
				// Attempt to execute the code
				const execResult =
					await positron.runtime.executeCode(
						languageId,
						options.input.code,
						true,  // focus console
						true,  // allow incomplete input, so that incomplete statements error right away
						positron.RuntimeCodeExecutionMode.Interactive,
						positron.RuntimeErrorBehavior.Stop,
						observer);

				// Currently just the text/plain output is returned
				const output = execResult['text/plain'];
				if (output) {
					result.result = output;
				}
			} catch (e) {
				result.error = e;
			}
			if (outputText) {
				result.outputText = outputText;
			}
			if (outputError) {
				result.outputError = outputError;
			}

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(JSON.stringify(result))
			]);
		}
	});

	context.subscriptions.push(executeCodeTool);
}
