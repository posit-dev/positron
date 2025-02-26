/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workspace } from 'vscode';

const DEFAULT_CLIENT_ID_V1 = 'aebc6443-996d-45c2-90f0-388ff96faa56';
const DEFAULT_TENANT_V1 = 'organizations';
const DEFAULT_CLIENT_ID_V2 = 'c27c220f-ce2f-4904-927d-333864217eeb';
const DEFAULT_TENANT_V2 = 'common';

const OIDC_SCOPES = ['openid', 'email', 'profile', 'offline_access'];
const GRAPH_TACK_ON_SCOPE = 'User.Read';

export class ScopeData {

	private readonly _defaultClientId: string;
	private readonly _defaultTenant: string;

	/**
	 * The full list of scopes including:
	 * * the original scopes passed to the constructor
	 * * internal VS Code scopes (e.g. `VSCODE_CLIENT_ID:...`)
	 * * the default scopes (`openid`, `email`, `profile`, `offline_access`)
	 */
	readonly allScopes: string[];

	/**
	 * The full list of scopes as a space-separated string. For logging.
	 */
	readonly scopeStr: string;

	/**
	 * The list of scopes to send to the token endpoint. This is the same as `scopes` but without the internal VS Code scopes.
	 */
	readonly scopesToSend: string[];

	/**
	 * The client ID to use for the token request. This is the value of the `VSCODE_CLIENT_ID:...` scope if present, otherwise the default client ID.
	 */
	readonly clientId: string;

	/**
	 * The tenant ID to use for the token request. This is the value of the `VSCODE_TENANT:...` scope if present, otherwise the default tenant ID.
	 */
	readonly tenant: string;

	constructor(readonly originalScopes: readonly string[] = []) {
		if (workspace.getConfiguration('microsoft-authentication').get<'v1' | 'v2'>('clientIdVersion') === 'v2') {
			this._defaultClientId = DEFAULT_CLIENT_ID_V2;
			this._defaultTenant = DEFAULT_TENANT_V2;
		} else {
			this._defaultClientId = DEFAULT_CLIENT_ID_V1;
			this._defaultTenant = DEFAULT_TENANT_V1;
		}

		const modifiedScopes = [...originalScopes];
		modifiedScopes.sort();
		this.allScopes = modifiedScopes;
		this.scopeStr = modifiedScopes.join(' ');
		this.scopesToSend = this.getScopesToSend(modifiedScopes);
		this.clientId = this.getClientId(this.allScopes);
		this.tenant = this.getTenantId(this.allScopes);
	}

	private getClientId(scopes: string[]) {
		return scopes.reduce<string | undefined>((prev, current) => {
			if (current.startsWith('VSCODE_CLIENT_ID:')) {
				return current.split('VSCODE_CLIENT_ID:')[1];
			}
			return prev;
		}, undefined) ?? this._defaultClientId;
	}

	private getTenantId(scopes: string[]) {
		return scopes.reduce<string | undefined>((prev, current) => {
			if (current.startsWith('VSCODE_TENANT:')) {
				return current.split('VSCODE_TENANT:')[1];
			}
			return prev;
		}, undefined) ?? this._defaultTenant;
	}

	private getScopesToSend(scopes: string[]) {
		const scopesToSend = scopes.filter(s => !s.startsWith('VSCODE_'));

		const set = new Set(scopesToSend);
		for (const scope of OIDC_SCOPES) {
			set.delete(scope);
		}

		// If we only had OIDC scopes, we need to add a tack-on scope to make the request valid
		// by forcing Identity into treating this as a Graph token request.
		if (!set.size) {
			scopesToSend.push(GRAPH_TACK_ON_SCOPE);
		}
		return scopesToSend;
	}
}
