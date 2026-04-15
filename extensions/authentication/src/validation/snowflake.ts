/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

class SnowflakeValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SnowflakeValidationError';
	}
}

/**
 * Validate Snowflake Cortex credentials.
 *
 * Snowflake's Cortex REST API does not expose a documented lightweight
 * endpoint suitable for credential validation. Credential errors are
 * surfaced at request time instead.
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
}
