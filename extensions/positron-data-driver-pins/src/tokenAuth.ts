/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateKeyPair, generateTokenId, TokenAuthenticator, TokenCredential } from './connectAuth.js';
import { ConnectClient, normalizeServerUrl } from './connectClient.js';
import { Logger, NULL_LOGGER } from './logging.js';

/** Dependencies for {@link claimToken}, injected so the flow is testable without a browser or real waiting. */
export interface TokenClaimDeps {
	/** The fetch implementation; defaults to global fetch. */
	fetch?: typeof fetch;
	/** Opens the claim URL in the user's browser (typically `vscode.env.openExternal`). */
	openExternal: (url: string) => Thenable<boolean>;
	/** Milliseconds between poll attempts; defaults to 500. */
	delayMs?: number;
	/** Maximum poll attempts; defaults to 60 (about 30 seconds at the default delay). */
	maxAttempts?: number;
	/** Returns true if the user cancelled; polling stops and the flow rejects. */
	isCancelled?: () => boolean;
	/** Logs progress; defaults to a no-op logger. */
	logger?: Logger;
}

/** The result of a successful claim: the credential to persist and the signed-in username. */
export interface TokenClaimResult {
	credential: TokenCredential;
	username: string;
}

/**
 * Registers a token with Connect and returns its claim URL. Unauthenticated: this is the bootstrap
 * step before the user has authenticated in the browser.
 */
async function registerToken(serverUrl: string, tokenId: string, publicKey: string, fetchFn: typeof fetch, logger: Logger): Promise<string> {
	const url = `${normalizeServerUrl(serverUrl)}/__api__/tokens`;
	const response = await fetchFn(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
		body: JSON.stringify({ token: tokenId, public_key: publicKey, user_id: 0 }),
	});
	// If the request was redirected off the Connect host, it never reached Connect's token endpoint.
	// This almost always means the server is behind single sign-on (the proxy 307-redirects the
	// unauthenticated POST to an identity provider), where browser token sign-in cannot work; fail
	// with a clear message instead of the JSON-parse error the identity provider's HTML would cause.
	// Host (not origin) comparison avoids a false positive on a plain http->https upgrade.
	if (response.url && new URL(response.url).host !== new URL(url).host) {
		logger.error(`The sign-in request was redirected off the Connect server from ${url} to ${response.url}.`);
		throw new Error(`The server at ${new URL(url).host} redirected the sign-in to a different site (${new URL(response.url).host}), which usually means it is behind single sign-on. Browser sign-in is not supported there; connect with an API key instead.`);
	}
	if (!response.ok) {
		throw new Error(`The Connect server rejected the sign-in request (HTTP ${response.status}). Check that the server URL is correct and that browser sign-in is enabled.`);
	}
	const json = await response.json() as { token_claim_url?: string };
	if (!json.token_claim_url) {
		throw new Error('The Connect server did not return a claim URL for the sign-in request.');
	}
	return json.token_claim_url;
}

/**
 * Runs the rsconnect-style browser sign-in: generate a keypair and token, register it, open the claim
 * URL, and poll the current-user endpoint (with signed requests) until the token is claimed. Resolves
 * with the credential to persist and the signed-in username; rejects on cancellation or timeout.
 */
export async function claimToken(serverUrl: string, deps: TokenClaimDeps): Promise<TokenClaimResult> {
	const fetchFn = deps.fetch ?? fetch;
	const logger = deps.logger ?? NULL_LOGGER;
	const delayMs = deps.delayMs ?? 500;
	const maxAttempts = deps.maxAttempts ?? 60;

	const tokenId = generateTokenId();
	const { privateKey, publicKey } = generateKeyPair();

	logger.info(`Registering a sign-in token with ${normalizeServerUrl(serverUrl)}`);
	let claimUrl: string;
	try {
		claimUrl = await registerToken(serverUrl, tokenId, publicKey, fetchFn, logger);
	} catch (err) {
		logger.error(`Failed to register a sign-in token: ${err instanceof Error ? err.message : String(err)}`);
		throw err;
	}
	logger.info(`Opening the sign-in page in your browser: ${claimUrl}`);
	await deps.openExternal(claimUrl);

	const credential: TokenCredential = { token: tokenId, privateKey };
	const client = new ConnectClient(serverUrl, new TokenAuthenticator(credential), fetchFn, logger);

	// Poll the current-user endpoint until the browser claim lands. A 401 is expected while unclaimed;
	// keep the last error so a persistent failure (e.g. a rejected signature) is reported on timeout
	// rather than being lost behind the generic timeout message.
	let lastError: unknown;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (deps.isCancelled?.()) {
			logger.info('Sign-in was cancelled before the token was claimed.');
			throw new Error('Sign-in was cancelled.');
		}
		try {
			const user = await client.getCurrentUser();
			logger.info(`Signed in as ${user.username || '(unknown user)'}`);
			return { credential, username: user.username };
		} catch (err) {
			lastError = err;
			logger.trace(`Sign-in not claimed yet (attempt ${attempt + 1}/${maxAttempts}): ${err instanceof Error ? err.message : String(err)}`);
		}
		await new Promise(resolve => setTimeout(resolve, delayMs));
	}
	logger.error(`Sign-in timed out after ${maxAttempts} attempts. Last response: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	throw new Error('Sign-in timed out before the token was claimed in the browser.');
}
