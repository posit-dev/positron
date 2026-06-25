/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import type { CompletionModel, LLMConfig, ModelsResponse } from './types.js';
import { getGatewayBaseUrl, getSelectedCompletionModelId } from './config.js';
import { getUserAgent } from './utils.js';
import { log } from './extension.js';

const PROVIDER_NAME = 'Posit AI';

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

async function ensureCompletionModelsCache(baseUrl: string, accessToken: string): Promise<CompletionModel[]> {
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
	}

	return cachedCompletionModels;
}

async function getGatewayCompletionModel(baseUrl: string, accessToken: string): Promise<CompletionModel> {
	const models = await ensureCompletionModelsCache(baseUrl, accessToken);

	if (!selectedModel || !models.includes(selectedModel)) {
		selectedModel = selectModel(models);
		log.info(`Selected completion model: ${selectedModel.id} (endpoint: ${selectedModel.endpointPath})`);
	}

	return selectedModel;
}

export async function getLLMConfiguration(): Promise<LLMConfig | null> {
	const session = await vscode.authentication.getSession('posit-ai', [], { silent: true });
	if (!session?.accessToken) {
		return null;
	}

	const baseUrl = getGatewayBaseUrl();
	const selectedModelId = getSelectedCompletionModelId();

	let model: CompletionModel | undefined;
	if (selectedModelId) {
		const models = await ensureCompletionModelsCache(baseUrl, session.accessToken);
		model = models.find((m) => m.id === selectedModelId);
		if (!model) {
			log.warn(`Configured completion model '${selectedModelId}' not found among available models, falling back to default.`);
		}
	} else {
		model = await getGatewayCompletionModel(baseUrl, session.accessToken);
	}

	return {
		providerDisplayName: PROVIDER_NAME,
		modelId: model?.id ?? DEFAULT_COMPLETION_MODEL.id,
		modelDisplayName: model?.displayName ?? DEFAULT_COMPLETION_MODEL.displayName,
		endpointPath: model?.endpointPath ?? DEFAULT_COMPLETION_MODEL.endpointPath,
		accessToken: session.accessToken,
		baseUrl,
		maxContextTokens: 5000,
		maxOutputTokens: 256,
		options: { userAgent: getUserAgent() },
	};
}

export function resetModelCache(): void {
	cachedCompletionModels = null;
	selectedModel = null;
}
