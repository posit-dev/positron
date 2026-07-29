/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { guardEntryNames, validateExtractedBundle } from '../../common/positronDocsValidate.js';
import { FakeFileStore } from './fakes.js';

describe('guardEntryNames', () => {
	it('accepts ordinary nested entries', () => {
		expect(guardEntryNames(['llms.txt', 'bundle.json', 'release-notes/release-2026-05.llms.md'])).toBeUndefined();
	});

	// The archive arrives over the network, so we assert these ourselves rather
	// than trusting base/node/zip.ts to have done it.
	it.each([
		['an absolute posix path', '/etc/passwd'],
		['a windows drive path', 'C:\\Windows\\system32'],
		['a parent traversal', '../../outside.md'],
		['a nested parent traversal', 'docs/../../outside.md'],
		['a null byte', 'llms\u0000.txt'],
		['a UNC path', '\\\\server\\share\\x'],
	])('rejects %s', (_label, entry) => {
		expect(guardEntryNames(['llms.txt', entry])).toContain(entry);
	});
});

describe('validateExtractedBundle', () => {
	const manifest = JSON.stringify({
		schema: 1, profile: 'positron', version: '2026.05.0-179',
		generated: '2026-07-24T18:02:11Z', docsBaseUrl: 'https://positron.posit.co/', fileCount: 3,
	});

	function store(entries: Record<string, string>) {
		return new FakeFileStore(entries);
	}

	it('accepts a well-formed extracted bundle', async () => {
		const files = store({
			'/c/2026.05.0-179/bundle.json': manifest,
			'/c/2026.05.0-179/llms.txt': '# Positron\n',
			'/c/2026.05.0-179/welcome.llms.md': '# Welcome\n',
		});
		const result = await validateExtractedBundle(files, '/c/2026.05.0-179');
		expect(result.ok && result.manifest.version).toBe('2026.05.0-179');
	});

	it('rejects a missing bundle.json', async () => {
		const files = store({ '/c/x/llms.txt': '# Positron\n' });
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'missing-manifest' });
	});

	it('rejects a missing llms.txt', async () => {
		const files = store({ '/c/x/bundle.json': manifest });
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'missing-index' });
	});

	it('rejects schema 2', async () => {
		const files = store({
			'/c/x/bundle.json': JSON.stringify({ ...JSON.parse(manifest), schema: 2 }),
			'/c/x/llms.txt': '# Positron\n',
		});
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'bad-manifest' });
	});

	it('rejects a fileCount that does not match what was extracted', async () => {
		const files = store({
			'/c/x/bundle.json': JSON.stringify({ ...JSON.parse(manifest), fileCount: 99 }),
			'/c/x/llms.txt': '# Positron\n',
		});
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'file-count-mismatch' });
	});
});
