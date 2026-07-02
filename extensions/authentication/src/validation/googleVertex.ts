/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { resolveGoogleVertexCredential } from '../credentials/googleVertex';

class GoogleVertexValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GoogleVertexValidationError';
	}
}

/**
 * Probe Google Vertex credentials by attempting to mint an OAuth token.
 *
 * Unlike the other validators in this directory, this function does not
 * validate a user-entered API key -- Vertex authentication is silent.
 * The `_apiKey` parameter is accepted to match the validator signature
 * and is ignored.
 */
export async function validateGoogleVertexCredentials(
	_apiKey: string,
	_config: positron.ai.LanguageModelConfig,
): Promise<void> {
	try {
		await resolveGoogleVertexCredential();
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new GoogleVertexValidationError(vscode.l10n.t(
			'Vertex AI: {0}',
			detail,
		));
	}
}
