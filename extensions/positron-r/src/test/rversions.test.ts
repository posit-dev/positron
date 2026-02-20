/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import { parseRVersionsFile } from '../provider-rversions';

suite('r-versions file parsing', () => {

	test('parses a single entry with Path only', () => {
		const content = 'Path: /opt/R/4.3.0';
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, undefined);
	});

	test('parses a single entry with Path and Label', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Label: R 4.3.0 (Production)',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0 (Production)');
	});

	test('parses multiple entries separated by blank lines', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Label: R 4.3.0',
			'',
			'Path: /opt/R/4.4.0',
			'Label: R 4.4.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 2);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0');
		assert.strictEqual(entries[1].path, '/opt/R/4.4.0');
		assert.strictEqual(entries[1].label, 'R 4.4.0');
	});

	test('parses all supported fields', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Label: R 4.3.0 (Production)',
			'Script: /opt/scripts/setup-r.sh',
			'Repo: /etc/rstudio/repos.conf',
			'Library: /opt/R/4.3.0/site-library:/shared/r-libs',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0 (Production)');
		assert.strictEqual(entries[0].script, '/opt/scripts/setup-r.sh');
		assert.strictEqual(entries[0].repo, '/etc/rstudio/repos.conf');
		assert.strictEqual(entries[0].library, '/opt/R/4.3.0/site-library:/shared/r-libs');
	});

	test('parses entry with Module instead of Path', () => {
		const content = [
			'Module: r/4.3.0',
			'Label: R 4.3.0 (Module)',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].module, 'r/4.3.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0 (Module)');
		assert.strictEqual(entries[0].path, undefined);
	});

	test('handles case-insensitive field names', () => {
		const content = [
			'path: /opt/R/4.3.0',
			'LABEL: R 4.3.0',
			'Path: /opt/R/4.4.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		// Keys are case-insensitive; if same key appears twice, last value wins
		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.4.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0');
	});

	test('skips entries without Path or Module', () => {
		const content = [
			'Label: Orphaned Label',
			'Script: /some/script.sh',
			'',
			'Path: /opt/R/4.3.0',
			'Label: Valid Entry',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, 'Valid Entry');
	});

	test('handles empty content', () => {
		const entries = parseRVersionsFile('');
		assert.strictEqual(entries.length, 0);
	});

	test('handles whitespace-only content', () => {
		const entries = parseRVersionsFile('   \n\n   \n');
		assert.strictEqual(entries.length, 0);
	});

	test('handles multiple blank lines between entries', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'',
			'',
			'Path: /opt/R/4.4.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 2);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[1].path, '/opt/R/4.4.0');
	});

	test('trims whitespace from keys and values', () => {
		const content = [
			'  Path  :   /opt/R/4.3.0',
			'  Label:R 4.3.0  ',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0');
	});

	test('handles values containing colons', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Library: /path/one:/path/two:/path/three',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].library, '/path/one:/path/two:/path/three');
	});

	test('ignores unknown field names', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'UnknownField: some value',
			'Label: R 4.3.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0');
	});

	test('ignores lines without colons', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'This line has no colon',
			'Label: R 4.3.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].path, '/opt/R/4.3.0');
		assert.strictEqual(entries[0].label, 'R 4.3.0');
	});
});
