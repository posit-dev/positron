/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import { PNG } from 'pngjs';
import { classify, generateDiff, formatSummary, formatHtml, formatChangedRatio } from './compare-and-report.mjs';

/**
 * Inject a tEXt metadata chunk right after the IHDR chunk of a valid PNG.
 * pngjs ignores metadata chunks on read, so pixels are unchanged but raw
 * bytes differ — simulating what happens when two tools encode the same image.
 */
function withTextChunk(pngBuf, keyword, value) {
	const data = Buffer.from(`${keyword}\0${value}`, 'latin1');
	const type = Buffer.from('tEXt');
	const crcVal = crc32(data, crc32(type));
	const len = Buffer.allocUnsafe(4);
	len.writeUInt32BE(data.length, 0);
	const crcBuf = Buffer.allocUnsafe(4);
	crcBuf.writeUInt32BE(crcVal >>> 0, 0);
	const chunk = Buffer.concat([len, type, data, crcBuf]);
	// IHDR chunk always ends at offset 33 (8 sig + 4 len + 4 type + 13 data + 4 crc)
	const AFTER_IHDR = 33;
	return Buffer.concat([pngBuf.subarray(0, AFTER_IHDR), chunk, pngBuf.subarray(AFTER_IHDR)]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function makePng(dir, name, payload) {
	const body = Buffer.concat([PNG_SIG, Buffer.from(payload)]);
	await writeFile(join(dir, name), body);
}

/**
 * Create a real 4-channel RGBA PNG where the left half is red and the right
 * half is blue. Used to test mask region behaviour.
 */
function makeRealPng(width, height, leftColor, rightColor) {
	const png = new PNG({ width, height });
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;
			const color = x < width / 2 ? leftColor : rightColor;
			png.data[idx] = color[0];
			png.data[idx + 1] = color[1];
			png.data[idx + 2] = color[2];
			png.data[idx + 3] = 255;
		}
	}
	return PNG.sync.write(png);
}

async function makeDirs() {
	const generated = await mkdtemp(join(tmpdir(), 'rs-gen-'));
	const docs = await mkdtemp(join(tmpdir(), 'rs-docs-'));
	return {
		generated,
		docs,
		cleanup: () => Promise.all([rm(generated, { recursive: true }), rm(docs, { recursive: true })]),
	};
}

test('classify: identical bytes -> unchanged', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		await makePng(generated, 'foo.png', 'same-bytes');
		await makePng(docs, 'foo.png', 'same-bytes');
		const result = await classify(generated, docs);
		assert.equal(result['foo.png'].status, 'unchanged');
		assert.equal(result['foo.png'].generatedHash, result['foo.png'].docsHash);
		assert.ok(result['foo.png'].generatedSize > 0);
	} finally {
		await cleanup();
	}
});

test('classify: different bytes, same name -> changed', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		await makePng(generated, 'foo.png', 'new-bytes');
		await makePng(docs, 'foo.png', 'old-bytes');
		const result = await classify(generated, docs);
		assert.equal(result['foo.png'].status, 'changed');
		assert.notEqual(result['foo.png'].generatedHash, result['foo.png'].docsHash);
	} finally {
		await cleanup();
	}
});

test('classify: different hashes but 0% pixel diff -> unchanged', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		// Same pixel data; docs copy has an injected tEXt metadata chunk so bytes
		// (and hashes) differ while pixels are identical. Simulates metadata-only
		// divergence between capture tools and the positron.posit.co image pipeline.
		const buf = makeRealPng(4, 4, [255, 0, 0], [0, 0, 255]);
		const withMeta = withTextChunk(buf, 'Software', 'different-tool');
		assert.ok(!buf.equals(withMeta), 'metadata injection should produce different bytes');
		await writeFile(join(generated, 'same.png'), buf);
		await writeFile(join(docs, 'same.png'), withMeta);
		const result = await classify(generated, docs);
		assert.equal(result['same.png'].status, 'unchanged');
	} finally {
		await cleanup();
	}
});

test('classify: present in generated only -> new', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		await makePng(generated, 'novel.png', 'data');
		const result = await classify(generated, docs);
		assert.equal(result['novel.png'].status, 'new');
		assert.equal(result['novel.png'].docsHash, undefined);
	} finally {
		await cleanup();
	}
});

test('classify: missing PNG signature -> throws', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		await writeFile(join(generated, 'broken.png'), Buffer.from('not-a-png'));
		await assert.rejects(classify(generated, docs), /not a valid PNG/i);
	} finally {
		await cleanup();
	}
});

test('classify: zero-byte file -> throws', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		await writeFile(join(generated, 'empty.png'), Buffer.alloc(0));
		await assert.rejects(classify(generated, docs), /empty/i);
	} finally {
		await cleanup();
	}
});

test('classify: ignores non-png files', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		await makePng(generated, 'real.png', 'x');
		await writeFile(join(generated, 'README.md'), 'not a png');
		const result = await classify(generated, docs);
		assert.deepEqual(Object.keys(result), ['real.png']);
	} finally {
		await cleanup();
	}
});

test('formatSummary: shows totals', () => {
	const classification = {
		'a.png': { status: 'unchanged', generatedHash: 'a', generatedSize: 1 },
		'b.png': { status: 'changed', generatedHash: 'b', generatedSize: 2, docsHash: 'old' },
		'c.png': { status: 'new', generatedHash: 'c', generatedSize: 3 },
	};
	const md = formatSummary(classification);
	assert.match(md, /Total: 3/);
	assert.match(md, /New: 1/);
	assert.match(md, /Changed: 1/);
	assert.match(md, /Unchanged: 1/);
});

test('formatSummary: title line is a link to the report when reportUrl is provided', () => {
	const classification = {
		'a.png': { status: 'changed', generatedHash: 'a', generatedSize: 1, docsHash: 'old' },
	};
	const md = formatSummary(classification, { reportUrl: 'https://example.com/run123/report.html' });
	assert.match(md, /\[Screenshot Report\]\(https:\/\/example\.com\/run123\/report\.html\)/);
});

test('formatSummary: title line is plain text when reportUrl is not provided', () => {
	const classification = {
		'a.png': { status: 'changed', generatedHash: 'a', generatedSize: 1, docsHash: 'old' },
	};
	const md = formatSummary(classification);
	assert.ok(!md.includes('['), 'should not include a markdown link when reportUrl is missing');
	assert.match(md, /Screenshot Report/);
});

test('formatSummary: empty classification renders cleanly', () => {
	const md = formatSummary({});
	assert.match(md, /No images/i);
});

test('formatHtml: includes one card per file with status section', () => {
	const classification = {
		'a.png': { status: 'unchanged', generatedHash: 'a', generatedSize: 1, docsHash: 'a' },
		'b.png': { status: 'changed', generatedHash: 'b', generatedSize: 2, docsHash: 'old' },
		'c.png': { status: 'new', generatedHash: 'c', generatedSize: 3 },
	};
	const html = formatHtml(classification, { screenshotBaseUrl: 'https://example.com/run123' });
	assert.match(html, /a\.png/);
	assert.match(html, /b\.png/);
	assert.match(html, /c\.png/);
	assert.match(html, /data-status="unchanged"/);
	assert.match(html, /data-status="changed"/);
	assert.match(html, /data-status="new"/);
});

test('formatHtml: includes Positron version in header when provided', () => {
	const html = formatHtml({}, { version: '2026.05.0-179' });
	assert.match(html, /Positron/);
	assert.match(html, /2026\.05\.0-179/);
});

test('formatHtml: omits version meta when not provided', () => {
	const html = formatHtml({});
	assert.ok(!html.includes('Positron <code'), 'should not render version chip when version is missing');
});

test('formatHtml: cards are sorted alphabetically by filename', () => {
	const classification = {
		'z.png': { status: 'changed', generatedHash: 'z', generatedSize: 1, docsHash: 'old' },
		'a.png': { status: 'changed', generatedHash: 'a', generatedSize: 2, docsHash: 'old' },
		'm.png': { status: 'changed', generatedHash: 'm', generatedSize: 3, docsHash: 'old' },
	};
	const html = formatHtml(classification, { screenshotBaseUrl: 'https://example.com/run123' });
	assert.ok(html.indexOf('a.png') < html.indexOf('m.png'), 'a.png must appear before m.png');
	assert.ok(html.indexOf('m.png') < html.indexOf('z.png'), 'm.png must appear before z.png');
});

test('formatHtml: new-status cards have placeholder for missing current image', () => {
	const classification = {
		'newonly.png': { status: 'new', generatedHash: 'x', generatedSize: 1 },
	};
	const html = formatHtml(classification, { screenshotBaseUrl: 'https://example.com/run123' });
	assert.match(html, /not on positron\.posit\.co/i);
});

test('formatHtml: escapes HTML-unsafe characters in filenames', () => {
	const classification = {
		'has<bad>.png': { status: 'new', generatedHash: 'x', generatedSize: 1 },
	};
	const html = formatHtml(classification, { screenshotBaseUrl: 'https://example.com/run123' });
	assert.ok(!html.includes('has<bad>.png'), 'unescaped angle brackets should not appear');
	assert.match(html, /has&lt;bad&gt;\.png/);
});

// --- formatChangedRatio ---

test('formatChangedRatio: zero renders as 0%', () => {
	assert.equal(formatChangedRatio(0), '0%');
});

test('formatChangedRatio: sub-0.1% renders as < 0.1% (not 0.0%)', () => {
	assert.equal(formatChangedRatio(0.0001), '< 0.1%');
	assert.equal(formatChangedRatio(0.00001), '< 0.1%');
});

test('formatChangedRatio: values >= 0.1% render as N.N%', () => {
	assert.equal(formatChangedRatio(0.001), '0.1%');
	assert.equal(formatChangedRatio(0.023), '2.3%');
	assert.equal(formatChangedRatio(1), '100.0%');
});

// --- generateDiff ---

test('generateDiff: unchanged pixels are dimmed, changed pixels are red', () => {
	// 16×16 image (large enough for the 7×7 blur kernel not to dominate):
	// left half red, right half blue in `gen`; right half green in `docs`.
	const gen = makeRealPng(16, 16, [255, 0, 0], [0, 0, 255]);
	const docs = makeRealPng(16, 16, [255, 0, 0], [0, 255, 0]);
	const result = generateDiff(gen, docs);
	assert.ok(result, 'should produce a diff result');
	const diff = PNG.sync.read(result.buf);
	// Sample deep in the left half (unchanged) — dim 30% of red: ~[76,0,0]
	const leftIdx = (8 * 16 + 1) * 4;
	assert.equal(diff.data[leftIdx], Math.round(255 * 0.3));
	assert.equal(diff.data[leftIdx + 1], 0);
	assert.equal(diff.data[leftIdx + 2], 0);
	// Sample deep in the right half (changed) — pixelmatch's diffColor
	const rightIdx = (8 * 16 + 14) * 4;
	assert.equal(diff.data[rightIdx], 255);
	assert.equal(diff.data[rightIdx + 1], 50);
	assert.equal(diff.data[rightIdx + 2], 50);
});

test('generateDiff: changedRatio reflects proportion of changed pixels', () => {
	// 16×16 with left half (8 cols) unchanged, right half changed → ratio ≈ 0.5.
	// (Exact 0.5 would require no blur; the box blur bleeds a column of edge
	// pixels across the boundary, so we accept a small window around 0.5.)
	const gen = makeRealPng(16, 16, [255, 0, 0], [0, 0, 255]);
	const docs = makeRealPng(16, 16, [255, 0, 0], [0, 255, 0]);
	const result = generateDiff(gen, docs);
	assert.ok(result);
	assert.ok(result.changedRatio > 0.35 && result.changedRatio < 0.55, `expected ~0.5, got ${result.changedRatio}`);
});

test('generateDiff: threshold suppresses small deltas', () => {
	// Small RGB delta of 10 — well below pixelmatch's default YIQ threshold (0.1) → ratio 0
	const gen = makeRealPng(4, 2, [255, 0, 0], [255, 0, 0]);
	const docs = makeRealPng(4, 2, [245, 0, 0], [245, 0, 0]);
	const result = generateDiff(gen, docs);
	assert.ok(result);
	assert.equal(result.changedRatio, 0, 'small delta should be below default threshold');
});

test('generateDiff: threshold option overrides default', () => {
	// Same small delta — but with a near-zero threshold, every pixel is flagged
	const gen = makeRealPng(4, 2, [255, 0, 0], [255, 0, 0]);
	const docs = makeRealPng(4, 2, [245, 0, 0], [245, 0, 0]);
	const result = generateDiff(gen, docs, [], { threshold: 0 });
	assert.ok(result);
	assert.equal(result.changedRatio, 1, 'any non-zero delta should exceed threshold=0');
});

test('generateDiff: masked regions are grey regardless of pixel content', () => {
	const gen = makeRealPng(4, 2, [255, 0, 0], [0, 0, 255]);
	const docs = makeRealPng(4, 2, [255, 0, 0], [0, 255, 0]);
	// regions param is reserved; passing it should not crash
	const result = generateDiff(gen, docs, [{ x: 0.5, y: 0, width: 0.5, height: 1 }]);
	assert.ok(result);
	// right half pixels still differ, so changedRatio > 0
	assert.ok(result.changedRatio > 0);
});

test('generateDiff: returns null for non-parseable input', () => {
	const fakeBuf = Buffer.concat([PNG_SIG, Buffer.from('bad-data')]);
	const real = makeRealPng(2, 2, [255, 0, 0], [0, 255, 0]);
	assert.equal(generateDiff(fakeBuf, real), null);
	assert.equal(generateDiff(real, fakeBuf), null);
});

test('generateDiff: returns null when images are different sizes', () => {
	const a = makeRealPng(4, 4, [255, 0, 0], [0, 0, 255]);
	const b = makeRealPng(8, 4, [255, 0, 0], [0, 0, 255]);
	assert.equal(generateDiff(a, b), null);
});
