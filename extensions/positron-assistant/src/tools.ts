/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { LanguageModelImage } from './languageModelParts.js';
import { ParticipantService } from './participants.js';

export enum PositronAssistantToolName {
	DocumentEdit = 'documentEdit',
	EditFile = 'vscode_editFile_internal',
	ExecuteCode = 'executeCode',
	GetPlot = 'getPlot',
	SelectionEdit = 'selectionEdit',
}

/**
 * Registers tools for the Positron Assistant.
 *
 * @param context The extension context for registering disposables
 * @param participants The Positron Assistant chat participants.
 */
export function registerAssistantTools(
	context: vscode.ExtensionContext,
	participantService: ParticipantService,
): void {
	const documentEditTool = vscode.lm.registerTool<{
		deltas: { delete: string; replace: string }[];
	}>(PositronAssistantToolName.DocumentEdit, {
		prepareInvocation: async (options, token) => {
			return {
				// Hide the tool invocation message from the user.
				presentation: 'hidden',
			};
		},

		invoke: async (options, token) => {
			if (!options.input.deltas) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No edits to apply.'),
				]);
			}

			// Get the active chat request data
			const { request, response } = getChatRequestData(options.chatRequestId, participantService);
			if (!(request.location2 instanceof vscode.ChatRequestEditorData)) {
				throw new Error('This tool can only be invoked from an editor.');
			}

			// Get the text of the document to edit
			const document = request.location2.document;
			const documentText = document.getText();

			// Process each change, emitting text edits for each one
			let numTextEdits = 0;
			for (const delta of options.input.deltas) {
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
				response.textEdit(document.uri, textEdit);
				numTextEdits++;
			}

			if (numTextEdits > 0) {
				// Complete the text edit group.
				response.textEdit(document.uri, true);

				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`Applied ${numTextEdits} of ${options.input.deltas.length} edits.`),
				]);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No edits applied.'),
				]);
			}
		}
	});

	context.subscriptions.push(documentEditTool);

	const selectionEditTool = vscode.lm.registerTool<{ code: string }>(PositronAssistantToolName.SelectionEdit, {
		prepareInvocation: async (options, token) => {
			// Hide the tool invocation message from the user.
			return {
				presentation: 'hidden',
			};
		},

		invoke: async (options, token) => {
			// Get the active chat request data.
			const { request, response } = getChatRequestData(options.chatRequestId, participantService);
			if (!(request.location2 instanceof vscode.ChatRequestEditorData)) {
				throw new Error('This tool can only be invoked from an editor.');
			}

			const document = request.location2.document;
			const selection = request.location2.selection;

			// Apply the edit to the selected text.
			const edits = vscode.TextEdit.replace(selection, options.input.code);
			response.textEdit(document.uri, edits);

			// Complete the text edit group.
			response.textEdit(document.uri, true);

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Selection edited.'),
			]);
		}
	});

	context.subscriptions.push(selectionEditTool);

	const executeCodeTool = vscode.lm.registerTool<{ code: string; language: string }>(PositronAssistantToolName.ExecuteCode, {
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
		prepareInvocation2: async (options, token) => {

			// Ask user for confirmation before proceeding
			const result: vscode.PreparedTerminalToolInvocation = {
				// The command (code to run)
				command: options.input.code,

				// The language (used for syntax highlighting)
				language: options.input.language,

				/// The message shown to confirm that the user wants to run the code.
				confirmationMessages: {
					title: vscode.l10n.t('Execute Code'),
					message: ''
				},
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

	const getPlotTool = vscode.lm.registerTool<{}>(PositronAssistantToolName.GetPlot, {
		prepareInvocation: async (options, token) => {
			return {
				// The message shown when the code is actually executing.
				// Positron appends '...' to this message.
				invocationMessage: vscode.l10n.t('Viewing the active plot'),
				pastTenseMessage: vscode.l10n.t('Viewed the active plot.'),
			};
		},
		invoke: async (options, token) => {
			// Get the current plot image data
			const uri = await positron.ai.getCurrentPlotUri();
			if (!uri) {
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No plot visible')]);
			}

			// Extract the MIME type and base64 data from the URI.
			const matches = uri?.match(/^data:([^;]+);base64,(.+)$/);
			if (!matches) {
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Internal Error: Positron returned an unexpected plot URI format')]);
			}

			// HACK: Return the image data as a prompt tsx part.
			// See languageModelParts.ts for an explanation.
			const image = new LanguageModelImage(matches[1], matches[2]);
			const imageJson = image.toJSON();
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelPromptTsxPart(imageJson)]);
		},
	});

	context.subscriptions.push(getPlotTool);
}

/**
 * Get the chat request data for a given tool invocation token.
 *
 * @param chatRequestId The ID of the chat request.
 * @param participants The participants in the chat.
 * @returns The request data for the given tool invocation token.
 * @throws Error if there is no tool invocation token or if the request data cannot be found.
 */
function getChatRequestData(
	chatRequestId: string | undefined,
	participantService: ParticipantService,
) {
	if (!chatRequestId) {
		throw new Error('This tool requires the chat request ID.');
	}

	const requestData = participantService.getRequestData(chatRequestId);
	if (!requestData) {
		throw new Error('This tool can only be invoked from a Positron Assistant chat request.');
	}

	return requestData;
}
