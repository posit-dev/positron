/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

const VALIDATION_TIMEOUT_MS = 5000;

class FoundryValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FoundryValidationError';
	}
}

/**
 * Normalize a user-provided Foundry URL to the v1 API base.
 * Handles deployment URLs, query parameters, and trailing slashes.
 */
export function normalizeToV1Url(rawUrl: string): string {
	let url = rawUrl.trim();
	if (!url) {
		return '';
	}
	const queryIndex = url.indexOf('?');
	if (queryIndex !== -1) {
		url = url.substring(0, queryIndex);
	}
	url = url.replace(/\/+$/, '');
	if (!url) {
		return '';
	}
	const deploymentIndex = url.indexOf('/openai/deployments/');
	if (deploymentIndex !== -1) {
		url = url.substring(0, deploymentIndex);
	}
	if (!url.endsWith('/openai/v1')) {
		url += '/openai/v1';
	}
	return url;
}

/**
 * Validate Foundry credentials by sending a minimal (intentionally invalid)
 * request to the chat completions endpoint. The server authenticates before
 * validating the request body, so 401/403 means bad credentials while
 * 400/422 means credentials are valid.
 */
export async function validateFoundryApiKey(
	apiKey: string,
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const rawBaseUrl = config.baseUrl?.trim();
	if (!rawBaseUrl) {
		throw new FoundryValidationError(
			vscode.l10n.t('Foundry base URL is required')
		);
	}

	const baseUrl = normalizeToV1Url(rawBaseUrl);
	const endpoint = `${baseUrl}/chat/completions`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ model: '', messages: [] }),
			signal: controller.signal,
		});

		if (response.status === 401 || response.status === 403) {
			throw new FoundryValidationError(
				vscode.l10n.t('Invalid Foundry API key')
			);
		}

		if (response.status === 404) {
			throw new FoundryValidationError(
				vscode.l10n.t('Foundry endpoint not found. Check your base URL.')
			);
		}

		// 400/422 = authenticated but bad request (expected), 200 = also fine
		if (response.ok || response.status === 400 || response.status === 422) {
			return;
		}

		throw new FoundryValidationError(vscode.l10n.t(
			'Unable to validate Foundry credentials (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new FoundryValidationError(vscode.l10n.t(
				'Could not validate Foundry credentials within {0} seconds',
				String(VALIDATION_TIMEOUT_MS / 1000)
			));
		}
		if (err instanceof FoundryValidationError) {
			throw err;
		}
		throw new FoundryValidationError(vscode.l10n.t(
			'Could not validate Foundry credentials. Check your network connection and try again.'
		));
	} finally {
		clearTimeout(timeout);
	}
}
