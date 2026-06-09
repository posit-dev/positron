/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';
import { normalizeHost } from '../databricksOAuth';

class DatabricksValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DatabricksValidationError';
	}
}

/**
 * Resolve the workspace host for validation: the config dialog's baseUrl
 * field, falling back to the saved credentials setting.
 */
function resolveValidationHost(
	config: positron.ai.LanguageModelConfig
): string | undefined {
	const fromConfig = config.baseUrl?.trim();
	if (fromConfig) {
		return fromConfig;
	}
	const credentials = vscode.workspace
		.getConfiguration('authentication.databricks')
		.get<Record<string, string>>('credentials', {});
	return credentials?.DATABRICKS_HOST?.trim() || undefined;
}

/**
 * Validate a Databricks personal access token against the workspace's
 * SCIM Me endpoint.
 */
export async function validateDatabricksApiKey(
	apiKey: string,
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const rawHost = resolveValidationHost(config);
	if (!rawHost) {
		throw new DatabricksValidationError(vscode.l10n.t(
			'Databricks workspace URL is required (e.g. https://adb-1234567890123456.7.azuredatabricks.net)'
		));
	}
	const host = normalizeHost(rawHost);
	const meEndpoint = `${host}/api/2.0/preview/scim/v2/Me`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), KEY_VALIDATION_TIMEOUT_MS);
	try {
		const response = await fetch(meEndpoint, {
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
			throw new DatabricksValidationError(
				vscode.l10n.t('Invalid Databricks personal access token')
			);
		}

		throw new DatabricksValidationError(vscode.l10n.t(
			'Unable to validate Databricks personal access token (HTTP {0})',
			String(response.status)
		));
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new DatabricksValidationError(vscode.l10n.t(
				'Could not validate Databricks personal access token within {0} seconds',
				String(KEY_VALIDATION_TIMEOUT_MS / 1000)
			));
		}
		if (err instanceof DatabricksValidationError) {
			throw err;
		}
		throw new DatabricksValidationError(vscode.l10n.t(
			'Could not reach the Databricks workspace at {0}. Check the workspace URL and your network connection, then try again.',
			host
		));
	} finally {
		clearTimeout(timeout);
	}
}
