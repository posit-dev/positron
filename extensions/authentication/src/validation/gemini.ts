/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';

class GeminiValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GeminiValidationError';
	}
}

export async function validateGeminiApiKey(
	apiKey: string,
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const baseUrl = (
		config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
	).replace(/\/+$/, '');
	const modelsEndpoint = `${baseUrl}/models`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS);
	try {
		const response = await fetch(modelsEndpoint, {
			method: 'GET',
			headers: {
				'x-goog-api-key': apiKey,
			},
			signal: controller.signal,
		});

		if (response.ok) {
			return;
		}

		if (response.status === 401 || response.status === 403
			|| response.status === 400) {
			throw new GeminiValidationError(
				vscode.l10n.t('Invalid Gemini API key')
			);
		}

		throw new GeminiValidationError(vscode.l10n.t(
			'Unable to validate Gemini API key (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new GeminiValidationError(vscode.l10n.t(
				'Could not validate Gemini API key within {0} seconds',
				String(KEY_VALIDATION_TIMEOUT_MS / 1000)
			));
		}
		if (err instanceof GeminiValidationError) {
			throw err;
		}
		throw new GeminiValidationError(vscode.l10n.t(
			'Could not validate Gemini API key. Check your network connection and try again.'
		));
	} finally {
		clearTimeout(timeout);
	}
}
