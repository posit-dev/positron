/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ANTHROPIC_API_VERSION, KEY_VALIDATION_TIMEOUT_MS } from '../constants';

class ApiKeyValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ApiKeyValidationError';
	}
}

export async function validateAnthropicApiKey(apiKey: string, config: positron.ai.LanguageModelConfig): Promise<void> {
	const baseUrl = (config.baseUrl?.trim() || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
	const modelsEndpoint = `${baseUrl}/models`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS);
	try {
		let firstResponse: Response | undefined;
		try {
			firstResponse = await fetch(modelsEndpoint, {
				method: 'GET',
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': ANTHROPIC_API_VERSION,
				},
				signal: controller.signal,
			});
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new ApiKeyValidationError(vscode.l10n.t('Could not validate Anthropic API key within {0} seconds', String(KEY_VALIDATION_TIMEOUT_MS / 1000)));
			}
			// Network error on first attempt: fall through to /v1/ retry below
		}

		if (firstResponse?.ok) {
			return;
		}

		if (firstResponse && (firstResponse.status === 401 || firstResponse.status === 403)) {
			throw new ApiKeyValidationError(vscode.l10n.t('Invalid Anthropic API key'));
		}

		// First attempt failed with a non-auth error (HTTP or network). Try with /v1/ appended
		// in case the user provided a base URL without the API version path segment.
		// Skip the retry if the URL already ends with /v1 to avoid /v1/v1/models.
		if (baseUrl.endsWith('/v1')) {
			if (firstResponse) {
				throw new ApiKeyValidationError(vscode.l10n.t(
					'Unable to validate Anthropic API key (HTTP {0})',
					String(firstResponse.status)
				));
			}
			throw new ApiKeyValidationError(vscode.l10n.t('Could not validate Anthropic API key. Check your network connection and try again.'));
		}
		const response = await fetch(`${baseUrl}/v1/models`, {
			method: 'GET',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': ANTHROPIC_API_VERSION,
			},
			signal: controller.signal,
		});

		if (response.ok) {
			return;
		}

		if (response.status === 401 || response.status === 403) {
			throw new ApiKeyValidationError(vscode.l10n.t('Invalid Anthropic API key'));
		}

		throw new ApiKeyValidationError(vscode.l10n.t(
			'Unable to validate Anthropic API key (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new ApiKeyValidationError(vscode.l10n.t('Could not validate Anthropic API key within {0} seconds', String(KEY_VALIDATION_TIMEOUT_MS / 1000)));
		}
		if (err instanceof ApiKeyValidationError) {
			throw err;
		}
		throw new ApiKeyValidationError(vscode.l10n.t('Could not validate Anthropic API key. Check your network connection and try again.'));
	} finally {
		clearTimeout(timeout);
	}
}
