/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';
import { log } from '../log';

interface ModelOverrideEntry {
	identifier?: string;
}

/**
 * Resolve a model identifier to send in the Custom Provider validation
 * request. Reads the first entry's `identifier` from
 * `positron.assistant.models.overrides.customProvider`. Returns `''` when
 * no usable override is configured.
 */
function getCustomProviderModel(): string {
	try {
		const overrides = vscode.workspace
			.getConfiguration('positron.assistant')
			.get<ModelOverrideEntry[]>('models.overrides.customProvider');
		if (Array.isArray(overrides) && overrides.length > 0) {
			const first = overrides[0]?.identifier?.trim();
			if (first) {
				return first;
			}
		}
	} catch {
	}
	return '';
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
		const model = getCustomProviderModel();
		const response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({ model, messages: [] }),
			signal: controller.signal,
		});

		if (response.ok || response.status === 400
			|| response.status === 422) {
			return;
		}

		if (response.status === 401) {
			throw new CustomProviderValidationError(
				vscode.l10n.t('Invalid Custom Provider API key')
			);
		}

		if (response.status === 403) {
			// Empty model + 403 usually means the gateway accepted the
			// credentials but does not authorize the default/empty model.
			// A real model + 403 is more likely a credential/scope issue.
			if (model === '') {
				throw new CustomProviderValidationError(
					vscode.l10n.t(
						'Custom Provider test model was rejected by the gateway. ' +
						'Your credentials may be valid, but the gateway does not allow ' +
						'access with an empty model. Configure a model override in ' +
						'`positron.assistant.models.overrides.customProvider` and try again.'
					)
				);
			}
			throw new CustomProviderValidationError(
				vscode.l10n.t('Invalid Custom Provider API key')
			);
		}

		if (response.status === 404) {
			log.warn(`[Custom Provider] Validation endpoint returned 404 for ${endpoint}; saving credentials anyway.`);
			return;
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
