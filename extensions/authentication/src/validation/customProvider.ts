/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';
import { log } from '../log';

/**
 * Placeholder model sent with the validation request. We only want to probe
 * whether the base URL and key reach the provider, not run a real completion,
 * so the model name is deliberately not a real one. A server that validates the
 * model rejects this with a model error (which we treat as "key is fine, model
 * is not real"); a server that ignores it falls through to the empty-messages
 * 400. Either way the key itself gets evaluated. See #13789.
 */
const VALIDATION_MODEL = 'positron-connectivity-check';

/**
 * A 401/403 can mean the key was rejected (auth) or that the model was rejected
 * (the key is fine). OpenAI-compatible servers word model rejections around the
 * "model" field, so a body mentioning it points at the model, not the key.
 */
function looksLikeModelError(body: string): boolean {
	return /model/i.test(body);
}

/** Read the response body without letting a read failure mask the real status. */
async function readBody(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return '';
	}
}

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
			vscode.l10n.t('Base URL is required')
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
			body: JSON.stringify({ model: VALIDATION_MODEL, messages: [] }),
			signal: controller.signal,
		});

		if (response.ok || response.status === 400
			|| response.status === 422) {
			return;
		}

		if (response.status === 401 || response.status === 403) {
			// The key reached the provider and got a rejection. If the body
			// points at the model rather than the key, the key is fine, so let
			// configuration proceed and let the real chat surface any model
			// problem later.
			const body = await readBody(response);
			if (looksLikeModelError(body)) {
				log.warn(`[Custom Provider] Validation endpoint returned ${response.status} for a model reason, not auth; saving credentials anyway.`);
				return;
			}
			throw new CustomProviderValidationError(
				vscode.l10n.t('Invalid API key')
			);
		}

		if (response.status === 404) {
			log.warn(`[Custom Provider] Validation endpoint returned 404 for ${endpoint}; saving credentials anyway.`);
			return;
		}

		throw new CustomProviderValidationError(vscode.l10n.t(
			'Unable to validate credentials (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new CustomProviderValidationError(vscode.l10n.t(
				'Could not validate credentials within {0} seconds',
				String(KEY_VALIDATION_TIMEOUT_MS / 1000)
			));
		}
		if (err instanceof CustomProviderValidationError) {
			throw err;
		}
		throw new CustomProviderValidationError(vscode.l10n.t(
			'Could not validate credentials. Check your network connection and try again.'
		));
	} finally {
		clearTimeout(timeout);
	}
}
