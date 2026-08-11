/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parses the stdout stream of the `license-manager-aws-sagemaker` client.
 *
 * The client writes two LF-terminated lines per refresh cycle: a base64
 * HMAC-SHA256 line, then a single-line JSON object. We read the JSON and
 * deliberately ignore the HMAC: the binary is our own child process, so the
 * pipe is already trusted, and verifying the digest would mean embedding the
 * shared symmetric key in this (open-source) server for no in-container gain.
 *
 * Several integer fields arrive string-encoded because of Go's `,string` struct
 * tags, so numeric fields are coerced rather than trusted to be JSON numbers.
 */

/** A single message decoded from the license manager's stdout stream. */
export interface LicenseManagerMessage {
	/** Lease status; 'activated' and 'expired' are the observed values. */
	status: string;
	/** License expiration as unix milliseconds, from the 'expiration' field. */
	expirationMs?: number;
	/** Days remaining on the license, from the 'days-left' field. */
	daysLeft?: number;
	/** Named user count. Arrives as a string (e.g. "30") and is coerced. */
	users?: number;
}

/**
 * Coerces a field that may arrive as a JSON number or a string-encoded number.
 * Returns undefined for absent or unparseable values so callers can tell "not
 * reported" apart from a genuine zero.
 */
function optionalNumber(value: unknown): number | undefined {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}

/**
 * Creates a parser for the license manager's stdout stream.
 *
 * The returned function accepts arbitrary chunks — stdout may split a frame at
 * any byte — and invokes `onMessage` once per complete JSON line.
 *
 * @param onMessage Called with each decoded message, in stream order.
 * @returns A function to feed stdout chunks into.
 */
export function createLicenseManagerStreamParser(
	onMessage: (m: LicenseManagerMessage) => void
): (chunk: Buffer | string) => void {
	// Holds an incomplete trailing line between chunks.
	let buffered = '';

	return (chunk: Buffer | string): void => {
		buffered += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

		const lines = buffered.split('\n');
		// The final element is whatever followed the last newline: either an
		// incomplete line or an empty string. Either way it must be held back.
		buffered = lines.pop() ?? '';

		for (const line of lines) {
			const trimmed = line.trim();
			// Skip the HMAC line, blank lines, and anything else non-JSON.
			// Base64 never starts with '{', so this cleanly selects messages.
			if (!trimmed.startsWith('{')) {
				continue;
			}

			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				// A truncated or malformed line must not kill the stream; the
				// next refresh cycle will report status again.
				continue;
			}

			onMessage({
				status: String(parsed['status'] ?? ''),
				expirationMs: optionalNumber(parsed['expiration']),
				daysLeft: optionalNumber(parsed['days-left']),
				users: optionalNumber(parsed['users']),
			});
		}
	};
}
