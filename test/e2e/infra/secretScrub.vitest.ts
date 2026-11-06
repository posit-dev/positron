/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { encodedForms, scrubBuffer, scrubDirectory } from './secretScrub';

const SECRET = 'fake"va/lu+e-123456';
const secrets = [{ name: 'FAKE_SECRET', value: SECRET }];

describe('secretScrub', () => {
	it('scrubs every encoding', () => {
		const forms = encodedForms(SECRET);
		expect(forms.map(f => f.encoding).sort()).toEqual(['base64', 'json', 'raw', 'url']);
		const input = Buffer.from(forms.map(f => `x ${f.text} y`).join('\n'), 'utf8');
		const { data, replaced } = scrubBuffer(input, secrets);
		expect(replaced).toBe(4);
		expect(data.toString('utf8')).toBe(forms.map(() => 'x *** y').join('\n'));
	});

	it('replaces the longer form first', () => {
		const long = 'fake-value-123456';
		const { data, replaced } = scrubBuffer(Buffer.from(`${long}-extra`), [
			{ name: 'A', value: 'fake-value' },
			{ name: 'B', value: long },
		]);
		expect(replaced).toBe(1);
		expect(data.toString()).toBe('***-extra');
	});

	it('leaves clean data byte-identical', () => {
		const input = Buffer.from([0xff, 0xfe, 0x41]);
		const { data, replaced } = scrubBuffer(input, secrets);
		expect(replaced).toBe(0);
		expect(data.equals(input)).toBe(true);
	});

	it('scrubs secrets next to invalid UTF-8 without damaging other bytes', () => {
		const input = Buffer.concat([Buffer.from([0xff]), Buffer.from(SECRET), Buffer.from([0xfe])]);
		const { data } = scrubBuffer(input, secrets);
		expect(data.equals(Buffer.concat([Buffer.from([0xff]), Buffer.from('***'), Buffer.from([0xfe])]))).toBe(true);
	});

	it('scrubDirectory rewrites nested files', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'scrub-'));
		try {
			mkdirSync(join(dir, 'a', 'b'), { recursive: true });
			writeFileSync(join(dir, 'a', 'b', 'log.txt'), `token=${SECRET}\n`);
			writeFileSync(join(dir, 'clean.txt'), 'nothing here');
			expect(await scrubDirectory(dir, secrets)).toBe(1);
			expect(readFileSync(join(dir, 'a', 'b', 'log.txt'), 'utf8')).toBe('token=***\n');
			expect(readFileSync(join(dir, 'clean.txt'), 'utf8')).toBe('nothing here');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
