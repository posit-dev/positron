/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { ModelConfig } from './configTypes.js';

/**
 * Models used for autocomplete/ghost text.
 *
 * A minor complication here is that there does not yet seem to be a universally agreed-upon FIM
 * completions API. OpenAI has a completions API, but it is considered legacy and does not work with
 * their latest models. Yet, some other providers still implement it for newer models.
 *
 * Other providers do not make available completion models or endpoints. For those providers we
 * emulate a FIM API with prompt engineering.
 */

//#region Document context

let recentFiles: string[] = [];
const RECENT_FILES_KEY = 'positron-assistant.recentFiles';
const MAX_HISTORY = 10;
const WINDOW_SIZE = 50;

export function registerHistoryTracking(context: vscode.ExtensionContext) {
	recentFiles = context.workspaceState.get(RECENT_FILES_KEY, []);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(document => {
			if (document.uri.scheme !== 'file') {
				return;
			}

			const path = document.uri.fsPath;
			recentFiles = recentFiles.filter(f => f !== path);
			recentFiles.unshift(path);

			if (recentFiles.length > MAX_HISTORY) {
				recentFiles = recentFiles.slice(0, MAX_HISTORY);
			}
			context.workspaceState.update(RECENT_FILES_KEY, recentFiles);
		})
	);
}

async function getRelatedContext(document: vscode.TextDocument) {
	// Ensure recent files are open and available as text documents, if possible
	await Promise.all(recentFiles.map(async (path) => {
		try {
			return await vscode.workspace.openTextDocument(path);
		} catch (error) {
			return null;
		}
	}));

	// Of the other documents now available, we only want type `file` with matching language ID
	const documents = vscode.workspace.textDocuments
		.filter((doc) => doc.uri.scheme === 'file')
		.filter((doc) => doc.languageId === document.languageId)
		.filter((doc) => doc.uri !== document.uri);

	// Slide a window over the contents of the remaining documents and return best matching section
	return Object.fromEntries(
		// Use async map to yield and avoid blocking
		await Promise.all(documents.map(async (doc) => {
			const best: { range?: vscode.Range; score: number } = { score: 0 };
			for (let low = 0; low < doc.lineCount; low += Math.floor(WINDOW_SIZE / 2)) {
				const high = Math.min(low + WINDOW_SIZE, doc.lineCount);
				const range = new vscode.Range(low, 0, high, 0);
				const score = textSimilarityScore(document.getText(), doc.getText(range));
				if (score > best.score) {
					best.score = score;
					best.range = range;
				}
			}
			return [doc.uri.fsPath, doc.getText(best.range)];
		}))
	);
}

function textSimilarityScore(text: string, window: string): number {
	// Compute the Jaccard similarity coefficient
	// TODO: Consider calculating TF-IDF and scoring via cosine similarity.
	const set1 = new Set(text.split(/\s+/).filter((word) => !!word));
	const set2 = new Set(window.split(/\s+/).filter((word) => !!word));

	const intersection = new Set([...set1].filter(x => set2.has(x)));
	const union = new Set([...set1, ...set2]);
	return union.size === 0 ? 1 : intersection.size / union.size;
}

abstract class CompletionModel implements vscode.InlineCompletionItemProvider {
	public name;
	public identifier;

	constructor(protected readonly _config: ModelConfig) {
		this.identifier = _config.id;
		this.name = _config.name;
	}

	abstract provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList>;

	async getDocumentContext(document: vscode.TextDocument, position: vscode.Position) {
		// Windows of best-matching text from recent related documents
		const related = await getRelatedContext(document);

		// Characters before and after the cursor on this line
		const curPrefix = document.lineAt(position.line).text.substring(0, position.character);
		const curSuffix = document.lineAt(position.line).text.substring(position.character);

		// Lines before and after the current line
		const prevLines = Array.from({ length: position.line }, (_, i) => {
			return document.lineAt(i).text;
		}).join('\n');
		const nextLines = Array.from({ length: document.lineCount - position.line - 1 }, (_, i) => {
			return document.lineAt(position.line + i + 1).text;
		}).join('\n');

		// Trim the prefix and suffix to avoid going over provider and model token limits.
		// We trim the suffix smaller to make room for additional document context.
		// TODO: There should be some way to configure these limits, based on model capability.
		const prefix = `${prevLines}\n${curPrefix}`.slice(-3072);
		const suffix = `${curSuffix}\n${nextLines}`.slice(0, 1024);

		return { related, prefix, suffix };
	}
}

//#endregion
//#region OpenAI Legacy API
// (OpenAI FIM, Mistral)

class OpenAILegacyCompletion extends CompletionModel {
	url: string;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'openai-legacy',
			displayName: 'OpenAI (Legacy)',
			settingName: 'openAILegacy'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'GPT 3.5 Turbo',
			model: 'gpt-3.5-turbo-instruct',
			apiKey: '',
			baseUrl: 'https://api.openai.com/v1',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.url = `${this._config.baseUrl}/completions`;
	}

	async getAccessToken() {
		return this._config.apiKey;
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		// Check if the file should be excluded from AI features
		if (!(await positron.ai.areCompletionsEnabled(document.uri))) {
			return [];
		}

		// Delay a little before hitting the network, we might be cancelled by further keystrokes
		await new Promise(resolve => setTimeout(resolve, 200));

		if (token.isCancellationRequested) {
			return [];
		}

		const { related, prefix, suffix } = await this.getDocumentContext(document, position);
		const relatedText = Object.values(related).join('\n');

		const accessToken = await this.getAccessToken();
		const response = await fetch(this.url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: this._config.model,
				temperature: 0.2,
				prompt: `${relatedText}\n${prefix}`,
				suffix: suffix,
				max_tokens: 128,
				stop: ['\n\n', '<|endoftext|>'],
			})
		});

		if (!response.ok) {
			throw new Error(response.statusText);
		}

		const data = await response.json() as {
			choices: { message: { content: string } }[];
		} | {
			choices: { text: string }[];
		};

		const completions = new vscode.InlineCompletionList(
			data.choices.map((choice) => {
				const item = new vscode.InlineCompletionItem(
					'text' in choice ? choice.text : choice.message.content
				);
				item.completeBracketPairs = true;
				return item;
			})
		);
		completions.enableForwardStability = true;
		return completions;
	}
}

class MistralCompletion extends OpenAILegacyCompletion {
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'mistral',
			displayName: 'Mistral AI',
			settingName: 'mistral'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'Codestral',
			model: 'codestral-latest',
			apiKey: '',
			baseUrl: 'https://api.mistral.ai/v1',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.url = `${this._config.baseUrl}/fim/completions`;
	}
}

//#endregion
//#region Module exports

export function newCompletionProvider(config: ModelConfig): vscode.InlineCompletionItemProvider {
	const providerClasses = {
		'mistral': MistralCompletion,
		'openai-legacy': OpenAILegacyCompletion,
	};

	if (!(config.provider in providerClasses)) {
		throw new Error(`Unsupported completion provider: ${config.provider}`);
	}

	return new providerClasses[config.provider as keyof typeof providerClasses](config);
}

export const completionModels = [
	MistralCompletion,
	OpenAILegacyCompletion,
];

//#endregion
