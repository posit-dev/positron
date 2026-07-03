/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import { dirname } from '../../../base/common/path.js';

/**
 * Shape of a valid persisted token: URL- and shell-safe, long enough to be
 * unguessable. A file that doesn't match (hand-edited, truncated, corrupted)
 * is treated as absent and regenerated.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * Load the per-user MCP bearer token from `tokenPath`, generating and
 * persisting a fresh one when the file is missing or malformed.
 *
 * The token is persistent (not per-run) on purpose: it is written literally
 * into workspace `.mcp.json` files, and rotating it on every restart would
 * invalidate all of them. It is stored user-private (0600) in the user data
 * dir, so on a shared machine other local users cannot read it -- which is
 * exactly the boundary the token exists to enforce.
 *
 * A persistence failure (unwritable user data dir) is reported through
 * `onWarning` and the freshly generated token is returned anyway: the server
 * stays secured for this run, and `.mcp.json` files just need a re-add after
 * the next restart.
 */
export function loadOrCreateMcpToken(tokenPath: string, onWarning?: (message: string) => void): string {
	try {
		const existing = fs.readFileSync(tokenPath, 'utf8').trim();
		if (TOKEN_PATTERN.test(existing)) {
			return existing;
		}
	} catch {
		// Missing or unreadable: fall through and generate.
	}
	const token = randomBytes(32).toString('hex');
	try {
		fs.mkdirSync(dirname(tokenPath), { recursive: true });
		fs.writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
	} catch (error) {
		onWarning?.(`Could not persist the MCP token to ${tokenPath} (${error instanceof Error ? error.message : String(error)}); using an in-memory token for this run.`);
	}
	return token;
}

/**
 * Whether an incoming `Authorization` header carries the expected bearer
 * token. Compares the whole `Bearer <token>` string in constant time
 * (timingSafeEqual): the length check leaks length, but the expected value is
 * fixed-format so length isn't secret. The scheme is matched literally
 * ("Bearer", the casing every MCP client sends) rather than case-insensitively,
 * so the comparison stays a single constant-time pass.
 */
export function isAuthorizedBearer(authorizationHeader: string | undefined, token: string): boolean {
	if (!authorizationHeader) {
		return false;
	}
	const expected = Buffer.from(`Bearer ${token}`);
	const actual = Buffer.from(authorizationHeader);
	return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}
