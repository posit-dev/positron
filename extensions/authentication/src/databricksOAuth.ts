/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'crypto';
import {
	DATABRICKS_OAUTH_CLIENT_ID,
	DATABRICKS_OAUTH_SCOPES,
} from './constants';

/**
 * Pure helpers for the Databricks OAuth 2.0 U2M flow (authorization code +
 * PKCE against the built-in `databricks-cli` public client). No vscode
 * imports so these can be unit tested directly.
 */

/** A resolved set of OAuth tokens. `expiresAt` is epoch milliseconds. */
export interface TokenSet {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

interface TokenEndpointResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	token_type?: string;
}

/**
 * Generate a PKCE verifier/challenge pair (S256).
 */
export function generatePkcePair(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

/**
 * Generate an opaque state value for CSRF protection.
 */
export function generateState(): string {
	return randomBytes(16).toString('base64url');
}

/**
 * Normalize a user-supplied workspace host: trim whitespace, prepend
 * https:// when no scheme is present, and strip trailing slashes.
 */
export function normalizeHost(raw: string): string {
	let host = raw.trim();
	if (host && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(host)) {
		host = `https://${host}`;
	}
	return host.replace(/\/+$/, '');
}

/** How long to wait for the well-known discovery document. */
const DISCOVERY_TIMEOUT_MS = 2000;

export interface OAuthEndpoints {
	authorizationEndpoint: string;
	tokenEndpoint: string;
}

const endpointCache = new Map<string, OAuthEndpoints>();

/** Test hook: clear the per-host discovery memo. */
export function resetOAuthEndpointCache(): void {
	endpointCache.clear();
}

function fallbackEndpoints(host: string): OAuthEndpoints {
	return {
		authorizationEndpoint: `${host}/oidc/v1/authorize`,
		tokenEndpoint: `${host}/oidc/v1/token`,
	};
}

/**
 * Discover the OAuth endpoints from the workspace's well-known metadata,
 * falling back to the hardcoded /oidc/v1 paths on any failure (including
 * 404 - a fatal 404 would regress workspaces that work today). Endpoints
 * outside the workspace origin are rejected: the authorization endpoint is
 * a URL the user's browser is sent to with an auth code in flight.
 */
export async function discoverOAuthEndpoints(
	host: string,
	signal?: AbortSignal
): Promise<OAuthEndpoints> {
	const normalized = normalizeHost(host);
	const cached = endpointCache.get(normalized);
	if (cached) {
		return cached;
	}
	const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
	try {
		const response = await fetch(
			`${normalized}/oidc/.well-known/oauth-authorization-server`,
			{ signal: signal ? AbortSignal.any([signal, timeout]) : timeout }
		);
		if (!response.ok) {
			return fallbackEndpoints(normalized);
		}
		const data = await response.json() as {
			authorization_endpoint?: string;
			token_endpoint?: string;
		};
		if (!data.authorization_endpoint || !data.token_endpoint) {
			return fallbackEndpoints(normalized);
		}
		const origin = new URL(normalized).origin;
		if (new URL(data.authorization_endpoint).origin !== origin ||
			new URL(data.token_endpoint).origin !== origin) {
			return fallbackEndpoints(normalized);
		}
		const endpoints: OAuthEndpoints = {
			authorizationEndpoint: data.authorization_endpoint,
			tokenEndpoint: data.token_endpoint,
		};
		endpointCache.set(normalized, endpoints);
		return endpoints;
	} catch {
		return fallbackEndpoints(normalized);
	}
}

/**
 * Build the authorization URL for the Databricks OIDC authorize endpoint.
 */
export function buildAuthorizeUrl(
	authorizationEndpoint: string,
	state: string,
	challenge: string,
	redirectUri: string
): string {
	const url = new URL(authorizationEndpoint);
	url.searchParams.set('client_id', DATABRICKS_OAUTH_CLIENT_ID);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('scope', DATABRICKS_OAUTH_SCOPES);
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	return url.toString();
}

async function postTokenEndpoint(
	tokenEndpoint: string,
	params: Record<string, string>,
	operation: string
): Promise<TokenEndpointResponse> {
	const response = await fetch(tokenEndpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params).toString(),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({})) as {
			error?: string;
			error_description?: string;
		};
		const detail = errorData.error_description
			?? errorData.error
			?? response.statusText;
		throw new Error(
			`Databricks ${operation} failed (HTTP ${response.status}): ${detail}`
		);
	}

	return await response.json() as TokenEndpointResponse;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
	tokenEndpoint: string,
	code: string,
	verifier: string,
	redirectUri: string
): Promise<TokenSet> {
	const data = await postTokenEndpoint(tokenEndpoint, {
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
		client_id: DATABRICKS_OAUTH_CLIENT_ID,
		code_verifier: verifier,
	}, 'token exchange');

	if (!data.access_token || !data.refresh_token) {
		throw new Error(
			'Databricks token exchange response is missing tokens'
		);
	}

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: Date.now() + data.expires_in * 1000,
	};
}

/**
 * Refresh an access token. Keeps the existing refresh token unless the
 * response includes a rotated one.
 */
export async function refreshTokens(
	tokenEndpoint: string,
	refreshToken: string
): Promise<TokenSet> {
	const data = await postTokenEndpoint(tokenEndpoint, {
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: DATABRICKS_OAUTH_CLIENT_ID,
	}, 'token refresh');

	if (!data.access_token) {
		throw new Error(
			'Databricks token refresh response is missing an access token'
		);
	}

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? refreshToken,
		expiresAt: Date.now() + data.expires_in * 1000,
	};
}
