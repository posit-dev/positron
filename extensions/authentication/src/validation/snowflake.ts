/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { isValidSnowflakeAccount } from '../snowflakeCredentials';

class SnowflakeValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SnowflakeValidationError';
	}
}

/**
 * Validate Snowflake Cortex credentials.
 *
 * config.baseUrl holds the bare account, not a URL, so validate it as an
 * account -- don't accept a user-supplied base URL (#13750). Snowflake's Cortex
 * REST API has no lightweight validation endpoint, so credential errors are
 * surfaced at request time instead.
 */
export async function validateSnowflakeApiKey(
	apiKey: string,
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const account = config.baseUrl?.trim();
	if (!account) {
		throw new SnowflakeValidationError(
			vscode.l10n.t('Snowflake account identifier is required')
		);
	}

	if (!isValidSnowflakeAccount(account)) {
		throw new SnowflakeValidationError(
			vscode.l10n.t(
				'Please set a valid Snowflake account identifier'
			)
		);
	}
}
