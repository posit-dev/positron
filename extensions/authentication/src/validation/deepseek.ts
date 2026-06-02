/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';

class DeepSeekValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DeepSeekValidationError';
	}
}

export async function validateDeepSeekApiKey(
	apiKey: string,
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const baseUrl = (
		config.baseUrl?.trim() || 'https://api.deepseek.com'
	).replace(/\/+$/, '');
	const modelsEndpoint = `${baseUrl}/models`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS);
	try {
		const response = await fetch(modelsEndpoint, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
			},
			signal: controller.signal,
		});

		if (response.ok) {
			return;
		}

		if (response.status === 401 || response.status === 403) {
			throw new DeepSeekValidationError(
				vscode.l10n.t('Invalid DeepSeek API key')
			);
		}

		throw new DeepSeekValidationError(vscode.l10n.t(
			'Unable to validate DeepSeek API key (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new DeepSeekValidationError(vscode.l10n.t(
				'Could not validate DeepSeek API key within {0} seconds',
				String(KEY_VALIDATION_TIMEOUT_MS / 1000)
			));
		}
		if (err instanceof DeepSeekValidationError) {
			throw err;
		}
		throw new DeepSeekValidationError(vscode.l10n.t(
			'Could not validate DeepSeek API key. Check your network connection and try again.'
		));
	} finally {
		clearTimeout(timeout);
	}
}
