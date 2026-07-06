/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { resolveGeapCredential } from '../credentials/geap';

class GeapValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GeapValidationError';
	}
}

/**
 * Probe Gemini Enterprise Agent Platform credentials by attempting to mint an
 * OAuth token.
 *
 * Unlike the other validators in this directory, this function does not
 * validate a user-entered API key -- Gemini Enterprise Agent Platform
 * authentication is silent. The `_apiKey` parameter is accepted to match the
 * validator signature and is ignored.
 */
export async function validateGeapCredentials(
	_apiKey: string,
	_config: positron.ai.LanguageModelConfig,
): Promise<void> {
	try {
		await resolveGeapCredential();
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new GeapValidationError(vscode.l10n.t(
			'Gemini Enterprise Agent Platform: {0}',
			detail,
		));
	}
}
