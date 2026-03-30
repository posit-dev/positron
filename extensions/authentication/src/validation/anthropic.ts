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
	const rawBaseUrl = (config.baseUrl ?? 'https://api.anthropic.com')
		.replace(/\/v1\/?$/, '')
		.replace(/\/+$/, '');
	const modelsEndpoint = `${rawBaseUrl}/v1/models`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS);
	try {
		const response = await fetch(modelsEndpoint, {
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
