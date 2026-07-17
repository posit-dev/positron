/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parsePinMeta } from '../meta.js';

suite('parsePinMeta', () => {
	test('parses a v1 manifest', () => {
		const meta = parsePinMeta([
			'file: data.parquet',
			'file_size: 1024',
			'pin_hash: abc123',
			'type: parquet',
			'title: "mtcars: a pinned dataset"',
			'description: The cars',
			'created: 20240115T093000Z',
			'api_version: 1',
		].join('\n'));
		assert.deepStrictEqual(meta, {
			file: 'data.parquet',
			fileSize: 1024,
			pinHash: 'abc123',
			type: 'parquet',
			title: 'mtcars: a pinned dataset',
			description: 'The cars',
			tags: undefined,
			urls: undefined,
			created: '20240115T093000Z',
			apiVersion: 1,
			user: undefined,
		});
	});

	test('treats a missing api_version as legacy v0 and aliases path to file', () => {
		const meta = parsePinMeta('path: data.rds\ntype: rds\n');
		assert.strictEqual(meta.apiVersion, 0);
		assert.strictEqual(meta.file, 'data.rds');
		assert.strictEqual(meta.type, 'rds');
	});

	test('parses a multi-file pin', () => {
		const meta = parsePinMeta('file:\n  - a.csv\n  - b.csv\ntype: csv\napi_version: 1\n');
		assert.deepStrictEqual(meta.file, ['a.csv', 'b.csv']);
	});

	test('rejects an unsupported future version', () => {
		assert.throws(() => parsePinMeta('type: parquet\napi_version: 2\n'), /Unsupported pin metadata version: 2/);
	});

	test('rejects non-mapping YAML', () => {
		assert.throws(() => parsePinMeta('- just\n- a\n- list\n'), /expected a YAML mapping/);
	});
});
