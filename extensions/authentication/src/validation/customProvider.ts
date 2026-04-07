/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';

class CustomProviderValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CustomProviderValidationError';
	}
}

export async function validateCustomProviderApiKey(
	apiKey: string,
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const baseUrl = config.baseUrl?.trim();
	if (!baseUrl) {
		throw new CustomProviderValidationError(
			vscode.l10n.t('Custom Provider base URL is required')
		);
	}

	const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (apiKey?.trim()) {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS
	);
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({ model: '', messages: [] }),
			signal: controller.signal,
		});

		if (response.ok || response.status === 400
			|| response.status === 422) {
			return;
		}

		if (response.status === 401 || response.status === 403) {
			throw new CustomProviderValidationError(
				vscode.l10n.t('Invalid Custom Provider API key')
			);
		}

		if (response.status === 404) {
			throw new CustomProviderValidationError(
				vscode.l10n.t(
					'Custom Provider endpoint not found. Check your base URL.'
				)
			);
		}

		throw new CustomProviderValidationError(vscode.l10n.t(
			'Unable to validate Custom Provider credentials (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new CustomProviderValidationError(vscode.l10n.t(
				'Could not validate Custom Provider credentials within {0} seconds',
				String(KEY_VALIDATION_TIMEOUT_MS / 1000)
			));
		}
		if (err instanceof CustomProviderValidationError) {
			throw err;
		}
		throw new CustomProviderValidationError(vscode.l10n.t(
			'Could not validate Custom Provider credentials. Check your network connection and try again.'
		));
	} finally {
		clearTimeout(timeout);
	}
}
