/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import * as ai from 'ai';
import * as vscode from 'vscode';
import { getAllModelDefinitions } from '../../modelDefinitions.js';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers.js';
import { ModelCapabilities } from '../base/modelProviderTypes.js';
import { ModelProviderLogger } from '../base/modelProviderLogger.js';
import { log } from '../../log.js';

/**
 * Checks if an error is a rate limit error (HTTP 429) from the native Anthropic SDK
 * and throws a user-friendly error with retry-after information if available.
 *
 * @param error - The error to check
 * @param providerName - The name of the provider for the error message prefix
 */
export function handleNativeSdkRateLimitError(error: unknown, providerName: string): void {
	if (error instanceof Anthropic.APIError && error.status === 429) {
		const retryAfter = error.headers?.get('retry-after');
		log.debug(`[${providerName}] Detected rate limit error from Anthropic SDK. Retry-After: ${retryAfter}`);
		if (retryAfter) {
			throw new Error(`[${providerName}] Rate limit exceeded. Please retry after ${retryAfter} seconds.`);
		}
		throw new Error(`[${providerName}] Rate limit exceeded. Please try again later.`);
	}
}

/**
 * Checks if an error is a rate limit error (HTTP 429) from the Vercel AI SDK
 * and throws a user-friendly error with retry-after information if available.
 *
 * Handles both direct APICallError and RetryError (which wraps multiple attempts).
 * When the SDK exhausts retries, it throws a RetryError containing the lastError.
 *
 * @param error - The error to check
 * @param providerName - The name of the provider for the error message prefix
 */
export function handleVercelSdkRateLimitError(error: unknown, providerName: string): void {
	// Check for RetryError first - the Vercel SDK wraps retried errors in this type
	// when maxRetries is exceeded
	let apiError: unknown = error;
	if (ai.RetryError.isInstance(error) && error.lastError) {
		apiError = error.lastError;
	}

	if (ai.APICallError.isInstance(apiError) && apiError.statusCode === 429) {
		const retryAfter = apiError.responseHeaders?.['retry-after'];
		log.debug(`[${providerName}] Detected rate limit error from Vercel SDK. Retry-After: ${retryAfter}`);
		if (retryAfter) {
			throw new Error(`[${providerName}] Rate limit exceeded. Please retry after ${retryAfter} seconds.`);
		}
		throw new Error(`[${providerName}] Rate limit exceeded. Please try again later.`);
	}
}

export const DEFAULT_ANTHROPIC_MODEL_NAME = 'Claude Sonnet 4';
export const DEFAULT_ANTHROPIC_MODEL_MATCH = 'claude-sonnet-4';

/**
 * Fetches models from the Anthropic API with pagination support.
 *
 * @param client - The Anthropic client instance
 * @param providerId - The provider identifier (e.g., 'anthropic-api')
 * @param providerName - The display name of the provider
 * @param capabilities - The model capabilities to include in model info
 * @param logger - Logger for debug/trace messages
 * @returns Array of model information, or undefined if fetching fails
 */
export async function fetchAnthropicModelsFromApi(
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

		logger.trace(`Fetching models from Anthropic API...`);

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

		return markDefaultModel(modelListing, providerId, DEFAULT_ANTHROPIC_MODEL_MATCH);
	} catch (error) {
		logger.warn(`Failed to fetch models from Anthropic API: ${error}`);
		return undefined;
	}
}

/**
 * Retrieves models from user configuration for Anthropic providers.
 *
 * @param providerId - The provider identifier (e.g., 'anthropic-api')
 * @param providerName - The display name of the provider
 * @param capabilities - The model capabilities to include in model info
 * @param logger - Logger for debug/trace messages
 * @returns Array of configured models, or undefined if no models are configured
 */
export function getAnthropicModelsFromConfig(
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

	return markDefaultModel(modelListing, providerId, DEFAULT_ANTHROPIC_MODEL_MATCH);
}
