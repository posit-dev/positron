/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { describe, expect, it } from 'vitest';
import {
	createLicenseManagerStreamParser,
	LicenseManagerMessage,
} from '../../node/licenseManagerStream.js';
import {
	ACTIVATED_FRAME,
	EXPIRED_FRAME,
	EXPIRED_WITH_PAST_EXPIRATION_FRAME,
} from './licenseManagerStub.js';

/**
 * These tests run against the fabricated frames in licenseManagerStub.ts,
 * which are shaped like the real license-manager-aws-sagemaker binary's wire
 * format. The frames are the wire contract; they must not be edited to make a
 * test pass.
 */
describe('createLicenseManagerStreamParser', () => {
	/** Feeds chunks through a parser and returns everything it emitted. */
	function collect(chunks: (Buffer | string)[]): LicenseManagerMessage[] {
		const messages: LicenseManagerMessage[] = [];
		const write = createLicenseManagerStreamParser(m => messages.push(m));
		for (const chunk of chunks) {
			write(chunk);
		}
		return messages;
	}

	it('parses an activated frame and coerces string-encoded fields', () => {
		const messages = collect([ACTIVATED_FRAME]);

		expect(messages).toHaveLength(1);
		expect(messages[0].status).toBe('activated');
		// 'expiration' arrives as a JSON number (unix ms).
		expect(messages[0].expirationMs).toBe(9999999999000);
		expect(messages[0].daysLeft).toBe(7);
		// 'users' arrives as the STRING "5" via Go's `,string` tag.
		expect(messages[0].users).toBe(5);
	});

	it('ignores the HMAC line that precedes every JSON line', () => {
		// The activated frame is exactly two lines; if the base64-looking HMAC
		// line were treated as a message we would see more than one message, and
		// the single message we do get proves the JSON line is the one parsed.
		const [hmacLine] = ACTIVATED_FRAME.split('\n');
		expect(hmacLine).toMatch(/^[A-Za-z0-9+/]+=*$/);

		expect(collect([ACTIVATED_FRAME])).toHaveLength(1);
	});

	it('emits nothing for HMAC-only, blank, and whitespace lines', () => {
		const [hmacLine] = ACTIVATED_FRAME.split('\n');
		expect(collect([`${hmacLine}\n\n   \n`])).toEqual([]);
	});

	it('emits a message only once the terminating newline arrives', () => {
		const withoutTrailingNewline = ACTIVATED_FRAME.slice(0, -1);

		const messages: LicenseManagerMessage[] = [];
		const write = createLicenseManagerStreamParser(m => messages.push(m));
		write(withoutTrailingNewline);

		// A partial line must be buffered, not parsed — otherwise a frame split
		// at the wrong byte would be silently dropped or double-counted.
		expect(messages).toEqual([]);
		write('\n');
		expect(messages).toHaveLength(1);
	});

	it('reassembles a frame fed one byte at a time', () => {
		const bytes = Buffer.from(ACTIVATED_FRAME, 'utf8');
		const chunks = Array.from(bytes, byte => Buffer.from([byte]));

		const messages = collect(chunks);

		expect(messages).toHaveLength(1);
		expect(messages[0].status).toBe('activated');
		expect(messages[0].users).toBe(5);
	});

	it('skips malformed JSON without throwing, and keeps parsing after it', () => {
		const messages = collect(['{"status":"activated",\n', ACTIVATED_FRAME]);

		expect(messages).toHaveLength(1);
		expect(messages[0].status).toBe('activated');
	});

	it('parses multiple frames arriving in one chunk, in order', () => {
		// Checkout plus one lease extension: two activated frames.
		const messages = collect([ACTIVATED_FRAME + ACTIVATED_FRAME]);

		expect(messages).toHaveLength(2);
		expect(messages.map(m => m.status)).toEqual(['activated', 'activated']);
		expect(messages.map(m => m.expirationMs)).toEqual([9999999999000, 9999999999000]);
	});

	it('parses repeated expired frames when nothing has ever been checked out', () => {
		const messages = collect([EXPIRED_FRAME + EXPIRED_FRAME + EXPIRED_FRAME]);

		expect(messages).toHaveLength(3);
		expect(messages.every(m => m.status === 'expired')).toBe(true);
		// Nothing was ever checked out, so expiration is 0 rather than a date.
		expect(messages[0].expirationMs).toBe(0);
		expect(messages[0].users).toBe(0);
		expect(messages[0].daysLeft).toBe(0);
	});

	it('parses expired frames that carry a past expiration rather than zero', () => {
		// The only observable difference from the never-checked-out case: a
		// license existed, so 'expiration' is a genuine (past) timestamp. Both
		// report status 'expired', which is what the state machine consumes.
		const messages = collect([
			EXPIRED_WITH_PAST_EXPIRATION_FRAME + EXPIRED_WITH_PAST_EXPIRATION_FRAME + EXPIRED_WITH_PAST_EXPIRATION_FRAME,
		]);

		expect(messages).toHaveLength(3);
		expect(messages.every(m => m.status === 'expired')).toBe(true);
		expect(messages[0].expirationMs).toBe(1600000000000);
	});

	it('splits frames on newlines regardless of chunk boundaries', () => {
		// Two frames arriving in one chunk, boundary mid-JSON of the first.
		const raw = ACTIVATED_FRAME + ACTIVATED_FRAME;
		const mid = Math.floor(raw.length / 3);

		const messages = collect([raw.slice(0, mid), raw.slice(mid)]);

		expect(messages).toHaveLength(2);
	});
});
