/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { classify, applyMasks, formatSummary, formatHtml } from './compare-and-report.mjs';

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

// --- applyMasks ---

test('applyMasks: returns original buffer when regions is empty', () => {
	const buf = makeRealPng(4, 4, [255, 0, 0], [0, 0, 255]);
	const result = applyMasks(buf, []);
	assert.deepEqual(result, applyMasks(buf, []));
});

test('applyMasks: paints masked region grey', () => {
	// 4×4 image: left half red, right half blue
	const buf = makeRealPng(4, 4, [255, 0, 0], [0, 0, 255]);
	// mask right half (x=0.5, width=0.5)
	const masked = applyMasks(buf, [{ x: 0.5, y: 0, width: 0.5, height: 1 }]);
	const png = PNG.sync.read(masked);
	// left half unchanged (red)
	const leftIdx = (0 * 4 + 0) * 4;
	assert.equal(png.data[leftIdx], 255);
	assert.equal(png.data[leftIdx + 1], 0);
	assert.equal(png.data[leftIdx + 2], 0);
	// right half greyed out
	const rightIdx = (0 * 4 + 2) * 4;
	assert.equal(png.data[rightIdx], 128);
	assert.equal(png.data[rightIdx + 1], 128);
	assert.equal(png.data[rightIdx + 2], 128);
});

test('applyMasks: two images differing only in masked area compare as unchanged', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		// generated: left=red, right=blue; docs: left=red, right=green
		// mask covers the right half — so the blue vs green difference is ignored
		const genBuf = makeRealPng(4, 4, [255, 0, 0], [0, 0, 255]);
		const docsBuf = makeRealPng(4, 4, [255, 0, 0], [0, 255, 0]);
		await writeFile(join(generated, 'test.png'), genBuf);
		await writeFile(join(docs, 'test.png'), docsBuf);
		const masks = { 'test.png': [{ x: 0.5, y: 0, width: 0.5, height: 1 }] };
		const result = await classify(generated, docs, masks);
		assert.equal(result['test.png'].status, 'unchanged');
	} finally {
		await cleanup();
	}
});

test('applyMasks: two images differing outside masked area compare as changed', async () => {
	const { generated, docs, cleanup } = await makeDirs();
	try {
		// generated: left=red; docs: left=green; right half masked
		const genBuf = makeRealPng(4, 4, [255, 0, 0], [0, 0, 255]);
		const docsBuf = makeRealPng(4, 4, [0, 255, 0], [0, 0, 255]);
		await writeFile(join(generated, 'test.png'), genBuf);
		await writeFile(join(docs, 'test.png'), docsBuf);
		const masks = { 'test.png': [{ x: 0.5, y: 0, width: 0.5, height: 1 }] };
		const result = await classify(generated, docs, masks);
		assert.equal(result['test.png'].status, 'changed');
	} finally {
		await cleanup();
	}
});

test('applyMasks: returns original buffer for non-parseable PNG (fake fixture)', () => {
	const fakeBuf = Buffer.concat([PNG_SIG, Buffer.from('not-real-png-data')]);
	const result = applyMasks(fakeBuf, [{ x: 0, y: 0, width: 1, height: 1 }]);
	assert.deepEqual(result, fakeBuf);
});
