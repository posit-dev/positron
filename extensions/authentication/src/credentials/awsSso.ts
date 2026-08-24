/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The AWS SDK appends this sentence to every token error that running
 * `aws sso login` would fix, and omits it from failures a login cannot fix
 * (no credentials configured, profile missing from the config file). Matching
 * it is how we tell a lapsed SSO session apart from every other credential
 * failure, without parsing `~/.aws/config` ourselves.
 */
const REFRESH_MARKER = /To refresh this SSO session run 'aws sso login'/i;

/** A credential-chain failure recognized as a lapsed AWS SSO session. */
export interface ExpiredSsoError {
	readonly kind: 'expired-sso';
	/** The profile the SDK named in the error, when it named one. */
	readonly profile?: string;
}

/**
 * Recognize a lapsed SSO session in a credential-chain failure. Returns
 * undefined for anything else, so callers gated on this keep their existing
 * behavior for every unrecognized failure.
 */
export function classifyAwsChainError(err: unknown): ExpiredSsoError | undefined {
	for (const message of errorMessages(err)) {
		if (!REFRESH_MARKER.test(message)) {
			continue;
		}
		const profile = /profile=(\S+)/.exec(message)?.[1];
		return profile ? { kind: 'expired-sso', profile } : { kind: 'expired-sso' };
	}
	return undefined;
}

/**
 * Messages from an error and its `cause` chain, outermost first. The chain
 * matters because the credential chain wraps the token provider's error in a
 * generic one before it reaches us.
 */
function errorMessages(err: unknown): string[] {
	const messages: string[] = [];
	let current: unknown = err;
	for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
		if (typeof current === 'string') {
			messages.push(current);
			break;
		}
		if (!(current instanceof Error)) {
			messages.push(String(current));
			break;
		}
		messages.push(current.message);
		current = (current as { cause?: unknown }).cause;
	}
	return messages;
}
