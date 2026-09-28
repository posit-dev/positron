/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { boxesToPaint, createReader, fold, paintBoxes, scanShots, secretEnv, showsValue } from './scan-shots.mjs';

// A made-up value with no real provider's prefix, shown in fixtures/shots/leak.png
// (and leak.jpg) in a terminal line and an unmasked password field; clean.png
// masks it.
const KEY = 'exploratoryfixtureQ7mZ2xK9pL4vR8tNw3';
const SECRETS = [{ name: 'EXAMPLE_TOKEN', value: KEY }];
const SHOTS = fileURLToPath(new URL('./fixtures/shots/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./scan-shots.mjs', import.meta.url));

/** A temporary directory holding copies of the named fixture shots. */
function shots(...names) {
	const dir = mkdtempSync(join(tmpdir(), 'scan-shots-'));
	for (const n of names) {
		copyFileSync(join(SHOTS, n), join(dir, n));
	}
	return dir;
}

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const line = (words, bbox = box(0, 0, 100, 10)) => ({ text: words.map(w => w.text).join(' '), bbox, words });

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

test('boxesToPaint takes the words that show a key, and nothing else on the line', () => {
	const boxes = boxesToPaint([
		line([{ text: 'export', bbox: box(0, 0, 40, 10) }, { text: `TOKEN=${KEY}`, bbox: box(50, 0, 300, 10) }]),
		line([{ text: 'Welcome', bbox: box(0, 20, 60, 30) }]),
	], SECRETS);
	assert.deepEqual(boxes, [box(50, 0, 300, 10)]);
});

test('boxesToPaint takes the rest of a key that wrapped onto the next line', () => {
	const boxes = boxesToPaint([
		line([{ text: KEY.slice(0, 26), bbox: box(0, 0, 200, 10) }]),
		line([{ text: KEY.slice(26), bbox: box(0, 12, 80, 22) }, { text: 'Cancel', bbox: box(100, 12, 140, 22) }]),
	], SECRETS);
	assert.deepEqual(boxes, [box(0, 0, 200, 10), box(0, 12, 80, 22)]);
});

test('boxesToPaint paints the words a split key is in, not the rest of the line', () => {
	// 12 characters each: a word needs about 17 to match a 20-character window on
	// its own. OCR joined the key's words with a word from another pane.
	const words = [0, 12, 24].map((at, k) => ({ text: KEY.slice(at, at + 12), bbox: box(k * 95, 0, k * 95 + 90, 10) }));
	const other = { text: 'Outline', bbox: box(600, 0, 660, 10) };
	const boxes = boxesToPaint([line([...words, other], box(0, 0, 660, 10))], SECRETS);
	// Every word of the key is covered, and nothing reaches the other pane.
	for (const w of words) {
		assert.ok(boxes.some(b => b.x0 <= w.bbox.x0 && b.x1 >= w.bbox.x1), `covers ${w.text}`);
	}
	assert.ok(boxes.every(b => b.x1 <= 280), JSON.stringify(boxes));
	assert.deepEqual(boxesToPaint([line([{ text: 'nothing', bbox: box(0, 0, 9, 9) }])], SECRETS), []);
});

test('boxesToPaint paints the pieces OCR split a URL into, even misread, and the end glued to its path', () => {
	// From a CI run: the field showed the URL whole, OCR split it into three
	// words and read `https://` as `hitps:/`, and only the middle got painted.
	const url = 'https://east2testaiqzv-resource.services.ai.azure.com';
	const field = line([
		{ text: 'hitps:/east2testa', bbox: box(0, 0, 110, 10) },
		{ text: 'iqzv-resource.services.ai.azur', bbox: box(112, 0, 320, 10) },
		{ text: 'e.com/openai/v1', bbox: box(322, 0, 420, 10) },
	]);
	for (const value of [url, url.replace('https://', '')]) {
		const boxes = boxesToPaint([field], [{ name: 'MS_FOUNDRY_BASE_URL', value }]);
		assert.ok(boxes.some(b => b.x0 === 0), `the start, misread, for ${value}`);
		assert.ok(boxes.some(b => b.x0 === 112), `the middle, for ${value}`);
		// `e.com` is the key's end, so the word it shares with the path goes too.
		assert.ok(boxes.some(b => b.x0 <= 322 && b.x1 >= 420), `the end, glued to the path, for ${value}`);
	}
});

test('boxesToPaint paints the word beside a match that carries the key\'s first or last characters', () => {
	// From the confirmation run: the secret starts at the host, OCR read
	// `https://eas` as one word, and only three of its characters are the key's.
	const host = 'east2testaiqzv-resource.services.ai.azure.com';
	const field = line([
		{ text: 'Base', bbox: box(0, 0, 30, 10) },
		{ text: 'https://eas', bbox: box(40, 0, 110, 10) },
		{ text: host.slice(3), bbox: box(112, 0, 400, 10) },
	]);
	const boxes = boxesToPaint([field], [{ name: 'MS_FOUNDRY_BASE_URL', value: host }]);
	assert.ok(boxes.some(b => b.x0 === 112), 'the match');
	assert.ok(boxes.some(b => b.x0 === 40 && b.x1 >= 112), 'the word beside it, which ends with the key\'s start, through to the match');
	assert.ok(!boxes.some(b => b.x0 === 0), 'not an ordinary word beside that');
	// Beside a match but sharing nothing with the key's ends: left alone.
	const plain = line([{ text: 'URL:', bbox: box(0, 0, 30, 10) }, { text: host, bbox: box(40, 0, 400, 10) }]);
	assert.deepEqual(boxesToPaint([plain], [{ name: 'X', value: host }]).map(b => b.x0), [40]);
});

test('boxesToPaint paints through a gap OCR left by boxing a glued word too narrowly', () => {
	// From run 36460815103: OCR boxed `https://eas` over `http` alone, and the
	// painted boxes left `s://eas` readable between them.
	const host = 'east2testaiqzv-resource.services.ai.azure.com';
	const field = line([
		{ text: 'https://eas', bbox: box(516, 0, 551, 10) },
		{ text: host.slice(3), bbox: box(603, 0, 913, 10) },
	]);
	const boxes = boxesToPaint([field], [{ name: 'MS_FOUNDRY_BASE_URL', value: host }]);
	assert.ok(boxes.some(b => b.x0 <= 516 && b.x1 >= 603), JSON.stringify(boxes));
});

test('boxesToPaint takes a piece only from the start or end of a key, not its middle', () => {
	const boxes = boxesToPaint([
		line([{ text: KEY, bbox: box(0, 0, 300, 10) }]),
		line([{ text: KEY.slice(10, 20), bbox: box(0, 20, 80, 30) }]),
	], SECRETS);
	assert.ok(boxes.some(b => b.y0 === 0), 'the key');
	assert.ok(!boxes.some(b => b.y0 === 20), 'not the piece from its middle');
});

test('paintBoxes fills each padded box with black and leaves the rest', () => {
	const painted = PNG.sync.read(paintBoxes(readFileSync(join(SHOTS, 'clean.png')), [box(10, 10, 20, 20)], 2));
	const at = (x, y) => [...painted.data.subarray((y * painted.width + x) * 4, (y * painted.width + x) * 4 + 4)];
	assert.deepEqual(at(8, 8), [0, 0, 0, 255]);
	assert.deepEqual(at(21, 21), [0, 0, 0, 255]);
	assert.notDeepEqual(at(30, 30), [0, 0, 0, 255]);
});

test('scanShots reports a shot OCR cannot read rather than skipping it', async () => {
	const dir = shots('clean.png');
	try {
		const results = await scanShots(dir, SECRETS, async () => {
			throw new Error('unreadable');
		});
		assert.deepEqual(results.map(r => r.status), ['unreadable']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('scanShots calls a shot a leak when painting does not stop the key reading', async () => {
	const dir = shots('leak.png');
	try {
		// This reader sees the key wherever it looks, painted or not.
		const read = async () => ({ text: KEY, lines: [line([{ text: KEY, bbox: box(0, 0, 50, 10) }])] });
		const results = await scanShots(dir, SECRETS, read);
		assert.deepEqual(results.map(r => [r.status, r.names]), [['leak', ['EXAMPLE_TOKEN']]]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('OCR paints the key out of a PNG, keeps the rest readable, and leaves a JPEG as a leak', async () => {
	const dir = shots('leak.png', 'leak.jpg', 'clean.png');
	const ocr = await createReader();
	try {
		const results = await scanShots(dir, SECRETS, ocr.read);
		assert.deepEqual(results.map(r => [r.file.split('/').pop(), r.status]), [['leak.jpg', 'leak'], ['leak.png', 'painted']]);
		// Painting keeps the evidence: the key is gone, the text around it is not.
		const after = (await ocr.read(join(dir, 'leak.png'))).text;
		assert.ok(!showsValue(after, KEY), after);
		assert.match(after, /export/);
		assert.match(after, /Password/);
	} finally {
		await ocr.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the CLI paints what it can, exits 1 on a shot it cannot, and removes that one with --remove', () => {
	const dir = shots('leak.png', 'leak.jpg', 'clean.png');
	try {
		const env = { PATH: process.env.PATH, EXAMPLE_TOKEN: KEY };
		assert.throws(() => execFileSync('node', [SCRIPT, dir], { env, stdio: 'pipe' }), e => e.status === 1 && /leak\.jpg shows EXAMPLE_TOKEN/.test(e.stderr) && !String(e.stdout + e.stderr).includes(KEY));
		const out = execFileSync('node', [SCRIPT, dir, '--remove'], { env, encoding: 'utf8' });
		assert.ok(!existsSync(join(dir, 'leak.jpg')));
		assert.ok(existsSync(join(dir, 'leak.png')));
		assert.ok(existsSync(join(dir, 'clean.png')));
		assert.ok(!out.includes(KEY), 'never prints the value');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('showsValue catches a field that shows only the end of a long key', () => {
	// 39 characters: stepping 20-character windows by 5 stops at 15, short of the tail.
	const long = 'abcdefghij0123456789klmnopqrstuvwxyzABC';
	assert.ok(showsValue(`value: ${long.slice(-20)}`, long));
	assert.ok(showsValue(`value: ${long.slice(0, 20)}`, long));
});
