/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';

class SnowflakeValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SnowflakeValidationError';
	}
}

/**
 * Validate Snowflake Cortex credentials by hitting the models endpoint.
 * The server authenticates before returning data, so 401/403 means bad
 * credentials while a successful response means the token is valid.
 */
export async function validateSnowflakeApiKey(
	apiKey: string,
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const baseUrl = config.baseUrl?.trim();
	if (!baseUrl) {
		throw new SnowflakeValidationError(
			vscode.l10n.t('Snowflake base URL is required')
		);
	}

	if (baseUrl.includes('<account_identifier>')) {
		throw new SnowflakeValidationError(
			vscode.l10n.t(
				'Please set your Snowflake account identifier in the base URL'
			)
		);
	}

	const endpoint = `${baseUrl}/chat/completions`;

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS
	);
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

		// A 400/422 means the server authenticated us but rejected
		// the empty request body -- credentials are valid.
		if (response.ok || response.status === 400
			|| response.status === 422) {
			return;
		}

		if (response.status === 401 || response.status === 403) {
			throw new SnowflakeValidationError(
				vscode.l10n.t('Invalid Snowflake credentials')
			);
		}

		if (response.status === 404) {
			throw new SnowflakeValidationError(
				vscode.l10n.t(
					'Snowflake endpoint not found. Check your base URL.'
				)
			);
		}

		throw new SnowflakeValidationError(vscode.l10n.t(
			'Unable to validate Snowflake credentials (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new SnowflakeValidationError(vscode.l10n.t(
				'Could not validate Snowflake credentials within {0} seconds',
				String(KEY_VALIDATION_TIMEOUT_MS / 1000)
			));
		}
		if (err instanceof SnowflakeValidationError) {
			throw err;
		}
		throw new SnowflakeValidationError(vscode.l10n.t(
			'Could not validate Snowflake credentials. Check your network connection and try again.'
		));
	} finally {
		clearTimeout(timeout);
	}
}
