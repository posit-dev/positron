/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import {
	CompletionTriggerKind,
	type CompletionModel,
	type InlineEditParams,
	type InlineEditResult,
	type LLMConfig,
	type ModelsResponse,
	type SubmitCompletionFeedbackParams,
	type SubmitCompletionFeedbackResponse,
} from './types.js';
import { RequestType } from 'vscode-languageclient';
import { getLanguageClientManager, startLanguageServer } from './client.js';
import { getUserAgent } from './utils.js';
import { getSessionVariables } from './variables.js';

type EnclosingBlock = {
	text: string;
	startLine: number;
	endLine: number;
};

const debounceDelayMs = 200;
const inlineEditRequest = new RequestType<InlineEditParams, InlineEditResult | null, void>(
	'textDocument/inlineEdit',
);

const submitCompletionFeedbackRequestType = new RequestType<
	SubmitCompletionFeedbackParams,
	SubmitCompletionFeedbackResponse,
	void
>('supercomplete/submitCompletionFeedback');

export const log = vscode.window.createOutputChannel('Next Edit Suggestions', { log: true });

function matchesGlobPattern(fileName: string, pattern: string): boolean {
	const baseName = fileName.substring(fileName.lastIndexOf('/') + 1);

	if (pattern.startsWith('*.')) {
		const extension = pattern.substring(1);
		return baseName.toLowerCase().endsWith(extension.toLowerCase());
	}

	return baseName === pattern;
}

function isCompletionEnabled(document: vscode.TextDocument): boolean {
	/* If a user has explicitly disabled assistant via the old method, honour that here too. */
	const assistantEnabled = vscode.workspace
		.getConfiguration('positron.assistant')
		.get<boolean>('enable', true);
	if (!assistantEnabled) {
		return false;
	}

	const enableConfig = vscode.workspace
		.getConfiguration('nextEditSuggestions')
		.get<Record<string, boolean>>('enable');

	const languageId = document.languageId;

	if (Object.hasOwn(enableConfig, languageId)) {
		return enableConfig[languageId];
	}

	const fileName = document.fileName;
	for (const key of Object.keys(enableConfig)) {
		if (key !== '*' && matchesGlobPattern(fileName, key)) {
			return enableConfig[key];
		}
	}

	return enableConfig['*'] ?? true;
}

function sendFeedback(
	correlationId: string | undefined,
	feedback: SubmitCompletionFeedbackParams['feedback'],
): void {
	log.debug(`[feedback] ${feedback}${correlationId ? ` (${correlationId})` : ''}`);

	const clientManager = getLanguageClientManager();
	if (!clientManager || !correlationId) {
		return;
	}

	void getLLMConfiguration().then((llmConfig) => {
		if (!llmConfig) {
			return;
		}
		clientManager.client
			.sendRequest(submitCompletionFeedbackRequestType, {
				correlationId,
				feedback,
				llmConfig,
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				log.warn(`Failed to submit completion feedback: ${message}`);
			});
	});
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(log);

	log.info('Next Edit Suggestions extension is now activating...');

	// Start the language server only when an auth token is available
	async function ensureLanguageServer() {
		if (getLanguageClientManager()) {
			return;
		}
		if (await getLLMConfiguration()) {
			startLanguageServer(context, log);
			log.info('Language server started.');
		}
	}

	void ensureLanguageServer();

	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions((e) => {
			if (e.provider.id === 'posit-ai') {
				void ensureLanguageServer();
			}
		}),
	);

	log.info('Next Edit Suggestions extension activated successfully!');

	context.subscriptions.push(
		vscode.commands.registerCommand('next-edit-suggestions.learnMore', () => {
			void vscode.env.openExternal(vscode.Uri.parse('https://posit.ai'));
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('next-edit-suggestions.restartLsp', async () => {
			try {
				log.info('Restarting LSP server...');
				const clientManager = getLanguageClientManager();
				if (clientManager) {
					await clientManager.client.stop();
					log.info('LSP server stopped');
					await clientManager.client.start();
					log.info('LSP server restarted successfully');
					void vscode.window.showInformationMessage('LSP server restarted successfully');
				} else {
					log.warn('LSP client manager not found');
					void vscode.window.showErrorMessage('LSP client manager not available');
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log.error(`Error restarting LSP: ${message}`);
				vscode.window.showErrorMessage(`Failed to restart LSP: ${message}`);
			}
		}),
	);

	const providerImpl = {
		displayName: 'Next Edit Suggestions',
		_onDidChangeEmitter: new vscode.EventEmitter<void>(),

		get onDidChange(): vscode.Event<void> {
			return this._onDidChangeEmitter.event;
		},

		provideInlineCompletionItems: async (
			document: vscode.TextDocument,
			position: vscode.Position,
			_context: vscode.InlineCompletionContext,
			_token: vscode.CancellationToken,
		): Promise<vscode.InlineCompletionList | undefined> => {
			if (!isCompletionEnabled(document)) {
				return new vscode.InlineCompletionList([]);
			}

			const timeoutPromise = new Promise<null>((resolve) => {
				setTimeout(() => resolve(null), 10000);
			});

			const result = await Promise.race([generateSuggestion(document, position), timeoutPromise]);
			if (!result) {
				return new vscode.InlineCompletionList([]);
			}

			const list = new vscode.InlineCompletionList([result]);
			list.enableForwardStability = true;

			return list;
		},

		handleDidShowCompletionItem(): void { },
		handleListEndOfLifetime(): void { },

		handleEndOfLifetime(item: vscode.InlineCompletionItem, reason: vscode.InlineCompletionEndOfLifeReason): void {
			let feedback: SubmitCompletionFeedbackParams['feedback'];
			switch (reason.kind) {
				case vscode.InlineCompletionEndOfLifeReasonKind.Accepted:
					feedback = 'accepted';
					break;
				case vscode.InlineCompletionEndOfLifeReasonKind.Rejected:
					feedback = 'rejected';
					break;
				case vscode.InlineCompletionEndOfLifeReasonKind.Ignored:
					feedback = 'ignored';
					break;
				default:
					return;
			}
			sendFeedback(item.correlationId, feedback);
		},
	};

	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider('*', providerImpl as vscode.InlineCompletionItemProvider, {
			displayName: 'Next Edit Suggestions',
			debounceDelayMs,
		}),
	);
}

async function generateSuggestion(
	document: vscode.TextDocument,
	position: vscode.Position,
): Promise<vscode.InlineCompletionItem | null> {
	try {
		const clientManager = getLanguageClientManager();
		if (!clientManager) {
			return null;
		}

		if (document.lineAt(position.line).text.includes('```')) {
			return null;
		}

		let startLine = position.line;
		for (let i = 1; i <= 5; i++) {
			const line = position.line - i;
			if (line < 0 || document.lineAt(line).text.includes('```')) {
				break;
			}
			startLine = line;
		}

		let endLine = position.line;
		for (let i = 1; i <= 5; i++) {
			const line = position.line + i;
			if (line >= document.lineCount || document.lineAt(line).text.includes('```')) {
				break;
			}
			endLine = line;
		}

		const enclosingBlocks = await getEnclosingBlocks(document, position);
		const contextBlock = enclosingBlocks.filter((block) => block.endLine - block.startLine <= 50).pop();

		let contextStartLine = Math.max(0, startLine - 5);
		let contextEndLine = Math.min(document.lineCount - 1, endLine + 5);
		if (contextBlock && contextBlock.endLine - contextBlock.startLine > 10) {
			contextStartLine = contextBlock.startLine;
			contextEndLine = contextBlock.endLine;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		const relativePath = workspaceFolder ? vscode.workspace.asRelativePath(document.uri, false) : document.uri.fsPath;

		let excerpt = '```' + relativePath + '\n';

		for (let i = contextStartLine; i < startLine; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		excerpt += '<|editable_region_start|>\n';

		for (let i = startLine; i < position.line; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		const currentLine = document.lineAt(position.line);
		const beforeCursor = currentLine.text.substring(0, position.character);
		const afterCursor = currentLine.text.substring(position.character);
		excerpt += beforeCursor + '<|user_cursor_is_here|>' + afterCursor + '\n';

		for (let i = position.line + 1; i <= endLine; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		excerpt += '<|editable_region_end|>\n';

		for (let i = endLine + 1; i <= contextEndLine; i++) {
			excerpt += document.lineAt(i).text + '\n';
		}

		excerpt += '```';

		const referencedNames = new Set(excerpt.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []);
		const sessionVariableContexts = await getSessionVariables(referencedNames);

		const llmConfig = await getLLMConfiguration();
		if (!llmConfig) {
			return null;
		}

		const params: InlineEditParams = {
			textDocument: { uri: document.uri.toString() },
			position: { line: position.line, character: position.character },
			variables: sessionVariableContexts,
			context: {
				triggerKind: CompletionTriggerKind.Invoked,
			},
			selection: {
				excerpt,
				editableRegionStart: { line: startLine, character: 0 },
				editableRegionEnd: { line: endLine, character: document.lineAt(endLine).text.length },
			},
			llmConfig,
		};

		const logParams = {
			...params,
			llmConfig: {
				...params.llmConfig,
				accessToken: '[***]'
			}
		};
		log.trace(`[request] ${JSON.stringify(logParams)}`);

		const result = await clientManager.client.sendRequest(inlineEditRequest, params);
		if (!result) {
			return null;
		}

		const suggestion = result.edits[0];

		if (!suggestion || suggestion.text.trim() === '') {
			sendFeedback(result.correlationId, 'filtered');
			return null;
		}

		// Deal with the model returning too few closing quotes when ending its response
		if (suggestion.text.endsWith('\n```')) {
			suggestion.text.substring(0, suggestion.text.length - 4);
		}

		const range = new vscode.Range(
			suggestion.range.start.line,
			suggestion.range.start.character,
			suggestion.range.end.line,
			suggestion.range.end.character,
		);

		log.trace(`[result] ${JSON.stringify({ text: suggestion.text, range: suggestion.range, correlationId: result.correlationId })}`);

		const showRange = new vscode.Range(contextStartLine, 0, contextEndLine, Number.MAX_SAFE_INTEGER);

		// Check if we should display this suggestion as ghost text
		const beforeText = document.getText(new vscode.Range(range.start, position));
		const afterText = document.getText(new vscode.Range(position, range.end));
		const beforeEqual = suggestion.text.startsWith(beforeText);
		const afterEqual = suggestion.text.endsWith(afterText);

		let item: vscode.InlineCompletionItem;

		if (beforeEqual && afterEqual) {
			const insertText = suggestion.text.slice(beforeText.length, suggestion.text.length - afterText.length);
			item = new vscode.InlineCompletionItem(insertText, new vscode.Range(position, position));
		} else {
			item = new vscode.InlineCompletionItem(suggestion.text, range);
			item.isInlineEdit = true;
			item.showInlineEditMenu = true;
			item.showRange = showRange;
			item.action = {
				title: 'Learn More',
				command: 'next-edit-suggestions.learnMore',
				tooltip: 'Learn more about Posit AI',
			};
		}

		item.correlationId = result.correlationId;

		return item;
	} catch (error) {
		log.error('Error generating suggestion from LSP:', error);
		return null;
	}
}

async function getEnclosingBlocks(document: vscode.TextDocument, position: vscode.Position): Promise<EnclosingBlock[]> {
	const blocks: EnclosingBlock[] = [];

	const selectionRanges = await vscode.commands.executeCommand<vscode.SelectionRange[]>(
		'vscode.executeSelectionRangeProvider',
		document.uri,
		[position],
	);

	if (selectionRanges && selectionRanges.length > 0) {
		let current: vscode.SelectionRange | undefined = selectionRanges[0];
		while (current) {
			const text = document.getText(current.range);
			blocks.push({
				text,
				startLine: current.range.start.line,
				endLine: current.range.end.line,
			});
			current = current.parent;
		}
	}

	return blocks;
}

const DEFAULT_BASE_URL = 'https://gateway.posit.ai';

const DEFAULT_COMPLETION_MODEL: CompletionModel = {
	id: 'qwen3-8b',
	displayName: 'Qwen3-8B',
	endpointPath: '/completions/qwen3-8b/predict',
	protocol: 'qwen3-8b',
	weight: 1.0,
};

let cachedCompletionModels: CompletionModel[] | null = null;
let cachedCompletionModelsTimestamp = 0;
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchCompletionModels(
	baseUrl: string,
	accessToken: string,
	userAgent?: string,
): Promise<CompletionModel[]> {
	const headers: Record<string, string> = {
		'Authorization': `Bearer ${accessToken}`,
		'Content-Type': 'application/json',
	};
	if (userAgent) {
		headers['User-Agent'] = userAgent;
	}

	const response = await fetch(`${baseUrl}/models`, {
		method: 'GET',
		headers,
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as ModelsResponse;

	if (!data.completions || data.completions.length === 0) {
		return [];
	}

	return data.completions.map((model) => ({
		id: model.id,
		displayName: model.display_name,
		endpointPath: model.endpoints[0]?.path ?? '',
		protocol: model.endpoints[0]?.protocol ?? '',
		weight: model.weight,
	}));
}

function selectModel(models: CompletionModel[]): CompletionModel {
	if (models.length === 0) {
		throw new Error('No completion models available');
	}

	if (models.length === 1) {
		return models[0];
	}

	const totalWeight = models.reduce((sum, m) => sum + m.weight, 0);
	let random = Math.random() * totalWeight;

	for (const model of models) {
		random -= model.weight;
		if (random <= 0) {
			return model;
		}
	}

	return models[models.length - 1];
}

let selectedModel: CompletionModel | null = null;

async function getGatewayCompletionModel(baseUrl: string, accessToken: string): Promise<CompletionModel> {
	if (!cachedCompletionModels || Date.now() - cachedCompletionModelsTimestamp > MODEL_CACHE_TTL_MS) {
		cachedCompletionModels = null;
		try {
			const models = await fetchCompletionModels(baseUrl, accessToken, getUserAgent());
			if (models.length > 0) {
				cachedCompletionModels = models;
				cachedCompletionModelsTimestamp = Date.now();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.warn(`Failed to fetch completion models, falling back to default: ${message}`);
		}

		if (!cachedCompletionModels) {
			cachedCompletionModels = [DEFAULT_COMPLETION_MODEL];
			cachedCompletionModelsTimestamp = Date.now();
		}

		selectedModel = selectModel(cachedCompletionModels);
		log.info(`Selected completion model: ${selectedModel.id} (endpoint: ${selectedModel.endpointPath})`);
	}

	return selectedModel!;
}

async function getLLMConfiguration(): Promise<LLMConfig | null> {
	const session = await vscode.authentication.getSession('posit-ai', [], { silent: true });
	if (!session?.accessToken) {
		return null;
	}

	const baseUrl = vscode.workspace
		.getConfiguration('authentication.positai')
		.inspect<string>('baseUrl')?.globalValue
		?? DEFAULT_BASE_URL;

	const selectedModelId = vscode.workspace
		.getConfiguration('nextEditSuggestions')
		.get<string>('selectedCompletionModel') || '';

	const model = selectedModelId
		? cachedCompletionModels?.find((m) => m.id === selectedModelId)
		: await getGatewayCompletionModel(baseUrl, session.accessToken);

	return {
		modelId: model?.id ?? DEFAULT_COMPLETION_MODEL.id,
		endpointPath: model?.endpointPath ?? DEFAULT_COMPLETION_MODEL.endpointPath,
		accessToken: session.accessToken,
		baseUrl,
		maxContextTokens: 5000,
		maxOutputTokens: 256,
		options: { userAgent: getUserAgent() },
	};
}

export function deactivate(): void { }
