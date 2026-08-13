/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { generateKeyPair, generateTokenId, TokenAuthenticator, TokenCredential } from './connectAuth.js';
import { ConnectClient, normalizeServerUrl } from './connectClient.js';

/** The message the flow rejects with when the user cancels, at any stage. */
const CANCELLED_MESSAGE = 'Sign-in was cancelled.';

/** Milliseconds between poll attempts while waiting for the browser claim. */
const DEFAULT_POLL_DELAY_MS = 1_000;

/**
 * The number of poll attempts before giving up, about five minutes at the default delay. A real sign-in
 * can involve opening a browser, an identity provider, and two-factor confirmation, so the ceiling is
 * deliberately generous (and longer than Posit's Publisher extension, whose 30-second window this flow
 * otherwise mirrors). The user can always cancel from the progress notification.
 */
const DEFAULT_MAX_ATTEMPTS = 300;

/** The timeout for the (fast, unauthenticated) token-registration request. */
const DEFAULT_REGISTRATION_TIMEOUT_MS = 30_000;

/** Dependencies for {@link claimToken}, injected so the flow is testable without a browser or real waiting. */
export interface TokenClaimDeps {
	/** The fetch implementation; defaults to global fetch. */
	fetch?: typeof fetch;
	/** Opens the claim URL in the user's browser (typically `vscode.env.openExternal`). */
	openExternal: (url: string) => Thenable<boolean>;
	/** Milliseconds between poll attempts; defaults to {@link DEFAULT_POLL_DELAY_MS}. */
	delayMs?: number;
	/** Maximum poll attempts; defaults to {@link DEFAULT_MAX_ATTEMPTS}. */
	maxAttempts?: number;
	/** Timeout for the token-registration request; defaults to {@link DEFAULT_REGISTRATION_TIMEOUT_MS}. */
	registrationTimeoutMs?: number;
	/**
	 * Cancels the whole flow when aborted. Wired into the registration request as well as the poll loop,
	 * so cancelling works while registration is still in flight, not only once polling has begun.
	 */
	signal?: AbortSignal;
	/** Logs progress; optional; nothing is logged when omitted. */
	logger?: positron.DataConnectionLogger;
}

/** Whether an error is a fetch abort (from cancellation or a timeout) rather than a real failure. */
function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}

/** The result of a successful claim: the credential to persist and the signed-in username. */
export interface TokenClaimResult {
	credential: TokenCredential;
	username: string;
}

/** The options {@link registerToken} needs beyond the token itself. */
interface RegisterTokenOptions {
	fetch: typeof fetch;
	logger?: positron.DataConnectionLogger;
	/** Aborts the request when the user cancels. */
	signal?: AbortSignal;
	/** The abort timeout for the request, in milliseconds. */
	timeoutMs: number;
}

/**
 * Registers a token with Connect and returns its claim URL. Unauthenticated: this is the bootstrap
 * step before the user has authenticated in the browser.
 *
 * The request gets its own abort wiring (the caller's cancellation signal plus a bounded timeout)
 * because it runs before polling starts: without it, a hung or unanswered registration would leave the
 * flow waiting forever with an inert Cancel button.
 */
async function registerToken(serverUrl: string, tokenId: string, publicKey: string, options: RegisterTokenOptions): Promise<string> {
	const { fetch: fetchFn, logger, signal, timeoutMs } = options;
	const url = `${normalizeServerUrl(serverUrl)}/__api__/tokens`;
	const host = new URL(url).host;

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (signal?.aborted) {
		controller.abort();
	}
	signal?.addEventListener('abort', onAbort);
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	let response: Response;
	try {
		response = await fetchFn(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
			body: JSON.stringify({ token: tokenId, public_key: publicKey, user_id: 0 }),
			signal: controller.signal,
		});
	} catch (err) {
		if (isAbortError(err)) {
			// The caller distinguishes a user cancellation from this timeout by checking its own signal.
			throw new Error(`Timed out registering a sign-in token with ${host}. Check that the server URL is correct and that the server is reachable.`);
		}
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Could not reach the Connect server at ${host} to start the sign-in: ${detail}`);
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', onAbort);
	}
	// If the request was redirected off the Connect host, it never reached Connect's token endpoint.
	// This almost always means the server is behind single sign-on (the proxy 307-redirects the
	// unauthenticated POST to an identity provider), where browser token sign-in cannot work; fail
	// with a clear message instead of the JSON-parse error the identity provider's HTML would cause.
	// Host (not origin) comparison avoids a false positive on a plain http->https upgrade.
	if (response.url && new URL(response.url).host !== host) {
		logger?.error(`The sign-in request was redirected off the Connect server from ${url} to ${response.url}.`);
		throw new Error(`The server at ${host} redirected the sign-in to a different site (${new URL(response.url).host}), which usually means it is behind single sign-on. Browser sign-in is not supported there; connect with an API key instead.`);
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
	const logger = deps.logger;
	const delayMs = deps.delayMs ?? DEFAULT_POLL_DELAY_MS;
	const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const signal = deps.signal;

	if (signal?.aborted) {
		throw new Error(CANCELLED_MESSAGE);
	}

	const tokenId = generateTokenId();
	const { privateKey, publicKey } = generateKeyPair();

	logger?.info(`Registering a sign-in token with ${normalizeServerUrl(serverUrl)}`);
	let claimUrl: string;
	try {
		claimUrl = await registerToken(serverUrl, tokenId, publicKey, {
			fetch: fetchFn,
			logger,
			signal,
			timeoutMs: deps.registrationTimeoutMs ?? DEFAULT_REGISTRATION_TIMEOUT_MS,
		});
	} catch (err) {
		// An abort during registration is the user cancelling, not a server problem; report it as such
		// rather than as a registration failure.
		if (signal?.aborted) {
			logger?.info('Sign-in was cancelled before the token was registered.');
			throw new Error(CANCELLED_MESSAGE);
		}
		logger?.error(`Failed to register a sign-in token: ${err instanceof Error ? err.message : String(err)}`);
		throw err;
	}
	logger?.info(`Opening the sign-in page in your browser: ${claimUrl}`);
	await deps.openExternal(claimUrl);

	const credential: TokenCredential = { token: tokenId, privateKey };
	const client = new ConnectClient(serverUrl, new TokenAuthenticator(credential), fetchFn, logger);

	// Poll the current-user endpoint until the browser claim lands. A 401 is expected while unclaimed;
	// keep the last error so a persistent failure (e.g. a rejected signature) is reported on timeout
	// rather than being lost behind the generic timeout message.
	let lastError: unknown;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (signal?.aborted) {
			logger?.info('Sign-in was cancelled before the token was claimed.');
			throw new Error(CANCELLED_MESSAGE);
		}
		try {
			const user = await client.getCurrentUser();
			logger?.info(`Signed in as ${user.username || '(unknown user)'}`);
			return { credential, username: user.username };
		} catch (err) {
			lastError = err;
			logger?.trace(`Sign-in not claimed yet (attempt ${attempt + 1}/${maxAttempts}): ${err instanceof Error ? err.message : String(err)}`);
		}
		// No wait after the final attempt: there is nothing left to poll, so sleeping only delays the
		// timeout error.
		if (attempt < maxAttempts - 1) {
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
	}
	logger?.error(`Sign-in timed out after ${maxAttempts} attempts. Last response: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	throw new Error('Sign-in timed out before the token was claimed in the browser.');
}
