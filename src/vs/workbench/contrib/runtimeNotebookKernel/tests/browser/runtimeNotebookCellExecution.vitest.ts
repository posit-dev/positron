/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { toOutputItems } from '../../browser/runtimeNotebookCellExecution.js';

describe('toOutputItems', () => {
	it('JSON round-trips an object payload for a custom +json mime type', () => {
		// vegalite v5 was not in the old hardcoded stringify list, so object
		// payloads fell to String(value) and became "[object Object]".
		const spec = { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', mark: 'point' };
		const items = toOutputItems({ 'application/vnd.vegalite.v5+json': spec });

		expect(items.length).toBe(1);
		expect(items[0].mime).toBe('application/vnd.vegalite.v5+json');
		expect(JSON.parse(items[0].data.toString())).toEqual(spec);
	});

	it('JSON-encodes object payloads for arbitrary custom mime types', () => {
		const payload = { a: [1, 2, 3], b: { nested: true } };
		const items = toOutputItems({ 'application/vnd.custom.thing+json': payload });

		expect(JSON.parse(items[0].data.toString())).toEqual(payload);
	});

	it('passes string payloads through unchanged', () => {
		const html = '<div>hello</div>';
		const preSerialized = '{"already": "json"}';
		const items = toOutputItems({
			'text/html': html,
			'application/vnd.positron.dataExplorer+json': preSerialized,
		});

		expect(items[0].data.toString()).toBe(html);
		// Pre-serialized JSON strings must not be double-encoded.
		expect(items[1].data.toString()).toBe(preSerialized);
	});

	it('decodes base64 image payloads into raw bytes', () => {
		// 'iVBORw0KGgo=' is the base64 encoding of the 8-byte PNG signature.
		const items = toOutputItems({ 'image/png': 'iVBORw0KGgo=' });

		expect(items[0].mime).toBe('image/png');
		expect(Array.from(items[0].data.buffer.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('stringifies primitive non-string payloads', () => {
		const items = toOutputItems({ 'application/x-count': 42 });

		expect(items[0].data.toString()).toBe('42');
	});
});
