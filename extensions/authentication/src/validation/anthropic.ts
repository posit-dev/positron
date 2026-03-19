/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const ANTHROPIC_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_API_VERSION = '2023-06-01';
const KEY_VALIDATION_TIMEOUT_MS = 5000;

export async function validateAnthropicApiKey(apiKey: string): Promise<void> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS);
	try {
		const response = await fetch(ANTHROPIC_MODELS_ENDPOINT, {
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
			throw new Error(vscode.l10n.t('Invalid Anthropic API key'));
		}

		throw new Error(vscode.l10n.t(
			'Unable to validate Anthropic API key (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new Error(vscode.l10n.t('Could not validate Anthropic API key within {0} seconds', String(KEY_VALIDATION_TIMEOUT_MS / 1000)));
		}
		if (err instanceof Error && err.message.includes('Invalid Anthropic API key')) {
			throw err;
		}
		throw new Error(vscode.l10n.t('Could not validate Anthropic API key. Check your network connection and try again.'));
	} finally {
		clearTimeout(timeout);
	}
}
