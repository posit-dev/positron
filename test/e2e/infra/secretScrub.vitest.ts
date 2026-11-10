/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { encodedForms, scrubBuffer, scrubDirectory } from './secretScrub';

const SECRET = 'fake"va/lu+e-123456';
const secrets = [{ name: 'FAKE_SECRET', value: SECRET }];

describe('secretScrub', () => {
	it('scrubs every encoding', () => {
		const forms = encodedForms(SECRET);
		expect([...new Set(forms.map(f => f.encoding))].sort()).toEqual(['base64', 'json', 'raw', 'url']);
		const input = Buffer.from(forms.map(f => `x ${f.text} y`).join('\n'), 'utf8');
		const { data, replaced } = scrubBuffer(input, secrets);
		expect(replaced).toBe(forms.length);
		expect(data.toString('utf8')).toBe(forms.map(() => 'x *** y').join('\n'));
	});

	it.each([0, 1, 2])('finds a base64 secret embedded at offset %i of a longer blob', offset => {
		const blob = Buffer.from('x'.repeat(offset) + 'user:' + SECRET + ':trailing-bytes').toString('base64');
		const input = Buffer.from(`token=${blob}\n`);
		const { data, replaced } = scrubBuffer(input, secrets);
		expect(replaced).toBeGreaterThan(0);
		expect(data.toString()).not.toContain(blob);
		expect(data.toString()).toContain('***');
	});

	it('finds a base64 secret at the very start and end of a blob', () => {
		const blob = Buffer.from(SECRET).toString('base64');
		expect(scrubBuffer(Buffer.from(blob), secrets).replaced).toBe(1);
	});

	it('scrubs a non-ASCII secret in raw form', () => {
		const secret = 'p\u00e4ssw\u00f6rd-\u4e2d\u6587-123';
		const { data, replaced } = scrubBuffer(Buffer.from(`a ${secret} b`, 'utf8'), [{ name: 'U', value: secret }]);
		expect(replaced).toBe(1);
		expect(data.toString('utf8')).toBe('a *** b');
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

	it('scrubDirectory does not write through a symlink', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'scrub-'));
		const outside = mkdtempSync(join(tmpdir(), 'scrub-out-'));
		try {
			writeFileSync(join(outside, 'target.txt'), `token=${SECRET}`);
			symlinkSync(join(outside, 'target.txt'), join(dir, 'link.txt'));
			expect(await scrubDirectory(dir, secrets)).toBe(0);
			expect(readFileSync(join(outside, 'target.txt'), 'utf8')).toBe(`token=${SECRET}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
