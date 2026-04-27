/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import { getAllModelDefinitions } from '../../modelDefinitions.js';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers.js';
import { ModelCapabilities } from '../base/modelProviderTypes.js';
import { ModelProviderLogger } from '../base/modelProviderLogger.js';

export const DEFAULT_DEEPSEEK_MODEL_NAME = 'DeepSeek-V4-Pro';
export const DEFAULT_DEEPSEEK_MODEL_MATCH = 'deepseek-v4-pro';

/**
 * Fetches models from the Deepseek API with pagination support.
 *
 * @param client - The Deepseek (Anthropic) client instance
 * @param providerId - The provider identifier (e.g., 'deepseek-api')
 * @param providerName - The display name of the provider
 * @param capabilities - The model capabilities to include in model info
 * @param logger - Logger for debug/trace messages
 * @returns Array of model information, or undefined if fetching fails
 */
export async function fetchDeepseekModelsFromApi(
	client: Anthropic,
	providerId: string,
	providerName: string,
	capabilities: ModelCapabilities,
	logger: ModelProviderLogger
): Promise<vscode.LanguageModelChatInformation[] | undefined> {
	try {
		const modelListing: vscode.LanguageModelChatInformation[] = [];
		const knownAnthropicModels = getAllModelDefinitions(providerId);
		let hasMore = true;
		let nextPageToken: string | undefined;

		logger.trace(`Fetching models from Deepseek API...`);

		while (hasMore) {
			const modelsPage = nextPageToken
				? await client.models.list({ after_id: nextPageToken })
				: await client.models.list();

			modelsPage.data.forEach(model => {
				const knownModel = knownAnthropicModels?.find(m => model.id.startsWith(m.identifier));

				modelListing.push(
					createModelInfo({
						id: model.id,
						name: model.display_name,
						family: providerId,
						version: model.created_at,
						provider: providerId,
						providerName: providerName,
						capabilities: capabilities,
						defaultMaxInput: knownModel?.maxInputTokens,
						defaultMaxOutput: knownModel?.maxOutputTokens
					})
				);
			});

			hasMore = modelsPage.has_more;
			if (hasMore && modelsPage.data.length > 0) {
				nextPageToken = modelsPage.data[modelsPage.data.length - 1].id;
			}
		}

		return markDefaultModel(modelListing, providerId, DEFAULT_DEEPSEEK_MODEL_MATCH);
	} catch (error) {
		logger.warn(`Failed to fetch models from Anthropic API: ${error}`);
		return undefined;
	}
}

/**
 * Retrieves models from user configuration for Deepseek providers.
 *
 * @param providerId - The provider identifier (e.g., 'deepseek-api')
 * @param providerName - The display name of the provider
 * @param capabilities - The model capabilities to include in model info
 * @param logger - Logger for debug/trace messages
 * @returns Array of configured models, or undefined if no models are configured
 */
export function getDeepseekModelsFromConfig(
	providerId: string,
	providerName: string,
	capabilities: ModelCapabilities,
	logger: ModelProviderLogger
): vscode.LanguageModelChatInformation[] | undefined {
	const configuredModels = getAllModelDefinitions(providerId);
	if (configuredModels.length === 0) {
		return undefined;
	}

	logger.info(`Using ${configuredModels.length} configured models.`);

	const modelListing = configuredModels.map((modelDef) =>
		createModelInfo({
			id: modelDef.identifier,
			name: modelDef.name,
			family: providerId,
			version: '',
			provider: providerId,
			providerName: providerName,
			capabilities: capabilities,
			defaultMaxInput: modelDef.maxInputTokens,
			defaultMaxOutput: modelDef.maxOutputTokens
		})
	);

	return markDefaultModel(modelListing, providerId, DEFAULT_DEEPSEEK_MODEL_MATCH);
}
