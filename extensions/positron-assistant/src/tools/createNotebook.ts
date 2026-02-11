/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../log.js';

interface CreateNotebookInput {
	language: 'python' | 'r';
}

/**
 * CreateNotebook tool implementation.
 */
export const createNotebookToolImpl = {
	prepareInvocation: async (options: { input: CreateNotebookInput }, _token: vscode.CancellationToken) => {
		const { language } = options.input;

		// Normalize and validate language for consistent behavior with invoke
		const lang = language?.toLowerCase();
		if (lang !== 'python' && lang !== 'r') {
			throw new Error(`Invalid language: "${language}". Must be "python" or "r".`);
		}

		const langDisplay = lang === 'python' ? 'Python' : 'R';
		return {
			invocationMessage: vscode.l10n.t('Creating {0} notebook', langDisplay),
			confirmationMessages: {
				title: vscode.l10n.t('Create Notebook'),
				message: vscode.l10n.t('Create a new {0} notebook?', langDisplay)
			},
			pastTenseMessage: vscode.l10n.t('Created {0} notebook', langDisplay),
		};
	},

	invoke: async (options: { input: CreateNotebookInput }, token: vscode.CancellationToken) => {
		const { language } = options.input;

		if (token.isCancellationRequested) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Operation cancelled')
			]);
		}

		// Validate language
		const lang = language?.toLowerCase();
		if (lang !== 'python' && lang !== 'r') {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Invalid language: "${language}". Must be "python" or "r".`)
			]);
		}

		try {
			// Check BEFORE creating whether there's already an active notebook
			// context. This determines whether the system prompt likely
			// included notebook tool instructions. This is not a perfect check
			// but short of doing a lot of hacky work to get the full prompt,
			// it's the best we can do. Worst case we double-instruct the
			// assistant.
			const hadNotebookBefore = !!(await positron.notebooks.getContext());

			// Set up event listener BEFORE executing command to avoid race conditions
			const notebookReady = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					disposable.dispose();
					reject(new Error('Timeout waiting for notebook editor to become active'));
				}, 5000); // 5 second safety timeout

				const disposable = vscode.window.onDidChangeActiveNotebookEditor(editor => {
					if (editor) {
						clearTimeout(timeout);
						disposable.dispose();
						resolve();
					}
				});

				// Check if already active (race condition protection)
				if (vscode.window.activeNotebookEditor) {
					clearTimeout(timeout);
					disposable.dispose();
					resolve();
				}
			});

			await vscode.commands.executeCommand('ipynb.newUntitledIpynb', lang);
			await notebookReady;

			const context = await positron.notebooks.getContext();
			if (!context) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Notebook created but context unavailable. The notebook should be open in the editor.')
				]);
			}

			// If there was already a notebook before, the system prompt likely
			// included notebook tool instructions. Return a simple result.
			if (hadNotebookBefore) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						`Created new ${lang} notebook. Use EditNotebookCells to add content.`
					)
				]);
			}

			// No notebook existed before, so the system prompt probably didn't
			// include notebook instructions. Provide detailed guidance.
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(
					`Created new ${lang} notebook.\n\n` +
					`To add cells, use EditNotebookCells with:\n` +
					`- operation: 'add'\n` +
					`- cellType: 'code' or 'markdown'\n` +
					`- index: -1 (append to end) or specific position\n` +
					`- content: the cell content\n\n` +
					`Example: {"operation":"add","cellType":"code","index":-1,"content":"print('Hello, world!')"}`
				)
			]);
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			log.error(`[CreateNotebook] Failed: ${msg}`);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Failed to create notebook: ${msg}`)
			]);
		}
	}
};

export const CreateNotebookTool = vscode.lm.registerTool<CreateNotebookInput>(
	PositronAssistantToolName.CreateNotebook,
	createNotebookToolImpl
);
