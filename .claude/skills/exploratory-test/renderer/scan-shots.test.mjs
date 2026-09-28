/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecognizer, fold, scanShots, secretEnv, showsValue } from './scan-shots.mjs';

// A made-up value with no real provider's prefix, shown in fixtures/shots/leak.png
// in a terminal line and an unmasked password field; clean.png masks it.
const KEY = 'exploratoryfixtureQ7mZ2xK9pL4vR8tNw3';
const SHOTS = fileURLToPath(new URL('./fixtures/shots/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./scan-shots.mjs', import.meta.url));

test('secretEnv takes credential-shaped names and the listed others, never short values', () => {
	const found = secretEnv({
		OPENAI_KEY: 'a'.repeat(20),
		GITHUB_TOKEN: 'b'.repeat(20),
		DATABRICKS_PAT: 'c'.repeat(20),
		SNOWFLAKE_USER: 'positron-ci-user',
		E2E_POSTGRES_PASSWORD: 'short',
		HOME: '/root/some/long/path',
		USER: 'somebody-long-enough',
	});
	assert.deepEqual(found.map(s => s.name), ['DATABRICKS_PAT', 'GITHUB_TOKEN', 'OPENAI_KEY', 'SNOWFLAKE_USER']);
});

test('fold ignores case, whitespace and the lookalikes OCR swaps', () => {
	assert.equal(fold('pL4vR8tNw3'), fold('pLAVRB tNWS'));
	assert.equal(fold('O0 Il1|'), 'oollll');
});

test('showsValue matches the misreadings OCR actually produced', () => {
	// Both are tesseract.js's reading of leak.png.
	assert.ok(showsValue('$ export EXAMPLE_TOKEN=exploratoryfixtureQ7mz2xk9pLAvRBtNW3', KEY));
	assert.ok(showsValue('Password [exploratoryfixtureQ7mZ2xK9pLAVRBINWS', KEY));
});

test('showsValue matches part of a key cut off by a narrow field', () => {
	assert.ok(showsValue('Token: exploratoryfixtureQ7mZ2x...', KEY));
});

test('showsValue does not match ordinary screen text or a variable name', () => {
	assert.ok(!showsValue('$ export EXAMPLE_TOKEN="$EXAMPLE_TOKEN"\nPassword [Fess', KEY));
	assert.ok(!showsValue('Welcome to Positron. Open a folder to get started with Python or R.', KEY));
});

test('scanShots reports a shot OCR cannot read rather than skipping it', async () => {
	const hits = await scanShots(SHOTS, [{ name: 'EXAMPLE_TOKEN', value: KEY }], async () => {
		throw new Error('unreadable');
	});
	assert.deepEqual(hits.map(h => h.names), [['(unreadable)'], ['(unreadable)']]);
});

test('OCR finds the key in the leaking screenshot and not in the masked one', async () => {
	const ocr = await createRecognizer();
	try {
		const hits = await scanShots(SHOTS, [{ name: 'EXAMPLE_TOKEN', value: KEY }], ocr.recognize);
		assert.deepEqual(hits.map(h => [h.file.split('/').pop(), h.names]), [['leak.png', ['EXAMPLE_TOKEN']]]);
	} finally {
		await ocr.close();
	}
});

test('the CLI removes a leaking shot with --remove and exits 1 without it', () => {
	const dir = mkdtempSync(join(tmpdir(), 'scan-shots-'));
	try {
		copyFileSync(join(SHOTS, 'leak.png'), join(dir, 'leak.png'));
		copyFileSync(join(SHOTS, 'clean.png'), join(dir, 'clean.png'));
		const env = { PATH: process.env.PATH, EXAMPLE_TOKEN: KEY };
		assert.throws(() => execFileSync('node', [SCRIPT, dir], { env, stdio: 'pipe' }), e => e.status === 1 && !String(e.stderr).includes(KEY));
		const out = execFileSync('node', [SCRIPT, dir, '--remove'], { env, encoding: 'utf8' });
		assert.ok(!existsSync(join(dir, 'leak.png')));
		assert.ok(existsSync(join(dir, 'clean.png')));
		assert.ok(!out.includes(KEY), 'never prints the value');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
