/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classify, formatSummary } from './compare-and-report.mjs';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function makePng(dir, name, payload) {
	const body = Buffer.concat([PNG_SIG, Buffer.from(payload)]);
	await writeFile(join(dir, name), body);
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

test('formatSummary: includes one row per file with emoji', () => {
	const classification = {
		'a.png': { status: 'unchanged', generatedHash: 'abc1234567890def', generatedSize: 100, docsHash: 'abc1234567890def' },
		'b.png': { status: 'changed', generatedHash: 'def4567890abcdef', generatedSize: 200, docsHash: 'old7890123456789' },
		'c.png': { status: 'new', generatedHash: 'ghi7890123456789', generatedSize: 300 },
	};
	const md = formatSummary(classification);
	assert.match(md, /a\.png/);
	assert.match(md, /b\.png/);
	assert.match(md, /c\.png/);
	assert.match(md, /✅/);
	assert.match(md, /🔄/);
	assert.match(md, /🆕/);
	// Hash is truncated to 8 chars; the 9th+ chars must not appear
	assert.match(md, /abc12345/);
	assert.ok(!md.includes('abc1234567890def'), 'full hash must not appear: truncation to 8 chars is broken');
});

test('formatSummary: shows totals row', () => {
	const classification = {
		'a.png': { status: 'unchanged', generatedHash: 'a', generatedSize: 1 },
		'b.png': { status: 'changed', generatedHash: 'b', generatedSize: 2, docsHash: 'old' },
		'c.png': { status: 'new', generatedHash: 'c', generatedSize: 3 },
	};
	const md = formatSummary(classification);
	assert.match(md, /1 unchanged/);
	assert.match(md, /1 changed/);
	assert.match(md, /1 new/);
});

test('formatSummary: empty classification renders cleanly', () => {
	const md = formatSummary({});
	assert.match(md, /No images/i);
});

test('formatSummary: rows are sorted alphabetically by filename', () => {
	const classification = {
		'z.png': { status: 'new', generatedHash: 'zzzzzzzzzzzzzzzz', generatedSize: 100 },
		'a.png': { status: 'unchanged', generatedHash: 'aaaaaaaaaaaaaaaa', generatedSize: 200, docsHash: 'aaaaaaaaaaaaaaaa' },
		'm.png': { status: 'changed', generatedHash: 'mmmmmmmmmmmmmmmm', generatedSize: 300, docsHash: 'nnnnnnnnnnnnnnnn' },
	};
	const md = formatSummary(classification);
	assert.ok(md.indexOf('a.png') < md.indexOf('m.png'), 'a.png must appear before m.png');
	assert.ok(md.indexOf('m.png') < md.indexOf('z.png'), 'm.png must appear before z.png');
});
