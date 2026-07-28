/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';

/**
 * A browser sign-in credential: a Connect token id and the base64 PKCS#1 DER RSA private key whose
 * public half was registered with the token. Requests are signed with these, rsconnect-style.
 */
export interface TokenCredential {
	/** The token id (an "T"-prefixed hex string), sent as the X-Auth-Token header. */
	token: string;
	/** The base64-encoded PKCS#1 DER RSA private key used to sign each request. */
	privateKey: string;
}

/** Computes the base64-encoded MD5 checksum of the body; the empty string for an absent body. */
export function md5Checksum(body: string | Buffer | Uint8Array | undefined): string {
	return crypto.createHash('md5').update(body ?? '').digest('base64');
}

/** Builds the canonical string Connect signs for token auth: "METHOD\nPATH\nDATE\nCHECKSUM". */
export function buildCanonicalRequest(method: string, path: string, date: string, checksum: string): string {
	return `${method}\n${path}\n${date}\n${checksum}`;
}

/**
 * Signs the canonical request string with RSA-SHA1 using the base64 PKCS#1 DER private key, returning
 * the base64-encoded signature.
 */
export function rsaSha1Sign(canonicalRequest: string, privateKeyBase64: string): string {
	const privateKey = crypto.createPrivateKey({ key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs1' });
	const signer = crypto.createSign('SHA1');
	signer.update(canonicalRequest);
	return signer.sign(privateKey, 'base64');
}

/**
 * Computes the per-request Connect token-auth headers (Date, X-Content-Checksum, X-Auth-Token,
 * X-Auth-Signature) for a request with a precomputed base64 MD5 body checksum.
 */
export function signRequestWithChecksum(method: string, path: string, checksum: string, token: string, privateKeyBase64: string): Record<string, string> {
	const date = new Date().toUTCString();
	const signature = rsaSha1Sign(buildCanonicalRequest(method, path, date, checksum), privateKeyBase64);
	return {
		'Date': date,
		'X-Content-Checksum': checksum,
		'X-Auth-Token': token,
		'X-Auth-Signature': signature,
	};
}

/** Generates a Connect-format token id: a "T" prefix followed by 16 random bytes as hex (33 chars). */
export function generateTokenId(): string {
	return `T${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Generates an RSA-2048 keypair as base64 DER: the private key in PKCS#1, the public key in SPKI, the
 * formats Connect's token registration and signing expect.
 */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
	const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs1', format: 'der' },
		publicKeyEncoding: { type: 'spki', format: 'der' },
	});
	return { privateKey: privateKey.toString('base64'), publicKey: publicKey.toString('base64') };
}

/**
 * Produces the auth headers for a single request. `KeyAuthenticator` returns a static API-key header
 * and ignores the request details; `TokenAuthenticator` signs each request, so it needs the method,
 * path, and body checksum. `ConnectClient` depends on this interface, not on any one auth scheme.
 */
export interface RequestAuthenticator {
	/**
	 * The remediation sentence appended to a 401/403 error, so the guidance matches the credential the
	 * connection actually uses (checking an API key vs re-running the browser sign-in).
	 */
	readonly authFailureHint: string;
	/**
	 * @param method The HTTP method (e.g. "GET").
	 * @param path The request pathname (Connect's token signature covers the pathname only, not the
	 * query string, so callers pass the pathname without any `?...` suffix).
	 * @param bodyChecksum The base64 MD5 of the request body (empty-body checksum for GETs).
	 */
	headers(method: string, path: string, bodyChecksum: string): Record<string, string>;
}

/** Authenticates with a Posit Connect API key: `Authorization: Key <apiKey>` on every request. */
export class KeyAuthenticator implements RequestAuthenticator {
	readonly authFailureHint = 'Check your API key and its permissions.';

	constructor(private readonly _apiKey: string) { }

	// The signing args are unused (an API key is a static header), but the full signature keeps the
	// concrete type matching RequestAuthenticator so callers can invoke it directly.
	headers(_method?: string, _path?: string, _bodyChecksum?: string): Record<string, string> {
		return { 'Authorization': `Key ${this._apiKey}` };
	}
}

/** Authenticates with a browser sign-in credential by signing each request rsconnect-style. */
export class TokenAuthenticator implements RequestAuthenticator {
	readonly authFailureHint = 'Your browser sign-in may have expired. Sign in again.';

	constructor(private readonly _credential: TokenCredential) { }

	headers(method: string, path: string, bodyChecksum: string): Record<string, string> {
		return signRequestWithChecksum(method, path, bodyChecksum, this._credential.token, this._credential.privateKey);
	}
}
