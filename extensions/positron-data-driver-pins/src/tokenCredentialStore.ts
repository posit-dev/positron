/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TokenCredential } from './connectAuth.js';
import { normalizeServerUrl } from './connectClient.js';

/** Persists browser sign-in credentials, keyed by server, across Positron sessions. */
export interface TokenCredentialStore {
	/** Returns the stored credential for a server, or undefined if none is stored (or it is malformed). */
	get(serverUrl: string): Promise<TokenCredential | undefined>;
	/** Stores (or replaces) the credential for a server. */
	set(serverUrl: string, credential: TokenCredential): Promise<void>;
}

/** The secret-storage key prefix for browser sign-in credentials. */
const KEY_PREFIX = 'pins.tokenAuth.';

/**
 * A {@link TokenCredentialStore} backed by the extension's secret storage. Credentials are keyed by
 * normalized server URL, so two saved connections to the same server share one sign-in.
 */
export class SecretTokenCredentialStore implements TokenCredentialStore {
	constructor(private readonly _secrets: vscode.SecretStorage) { }

	async get(serverUrl: string): Promise<TokenCredential | undefined> {
		const raw = await this._secrets.get(this._key(serverUrl));
		if (!raw) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as Partial<TokenCredential>;
			if (typeof parsed.token === 'string' && typeof parsed.privateKey === 'string') {
				return { token: parsed.token, privateKey: parsed.privateKey };
			}
		} catch {
			// A malformed entry is treated as absent, so the caller re-runs the claim flow.
		}
		return undefined;
	}

	async set(serverUrl: string, credential: TokenCredential): Promise<void> {
		await this._secrets.store(this._key(serverUrl), JSON.stringify(credential));
	}

	private _key(serverUrl: string): string {
		return `${KEY_PREFIX}${normalizeServerUrl(serverUrl)}`;
	}
}
