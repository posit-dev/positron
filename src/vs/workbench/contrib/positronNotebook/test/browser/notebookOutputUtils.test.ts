/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseOutputData } from '../../browser/getOutputContents.js';
import { pickPreferredOutputItem } from '../../browser/PositronNotebookCells/notebookOutputUtils.js';

function makeOutputItem(mime: string, text: string) {
	return { mime, data: VSBuffer.fromString(text) };
}

suite('Notebook Output Utils', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parseOutputData', () => {
		test('parses image/svg+xml into an image with a data URL', () => {
			const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
			const result = parseOutputData(makeOutputItem('image/svg+xml', svg));

			assert.strictEqual(result.type, 'image');
			const { dataUrl } = result as { type: 'image'; dataUrl: string };
			assert.ok(
				dataUrl.startsWith('data:image/svg+xml,'),
				'data URL should use the svg+xml MIME type'
			);
			assert.ok(
				dataUrl.includes(encodeURIComponent(svg)),
				'data URL should contain the URI-encoded SVG markup'
			);
		});

		test('parses image/png into an image with a base64 data URL', () => {
			const pngData = 'iVBORw0KGgo='; // stub PNG header
			const result = parseOutputData(makeOutputItem('image/png', pngData));

			assert.strictEqual(result.type, 'image');
			const { dataUrl } = result as { type: 'image'; dataUrl: string };
			assert.ok(
				dataUrl.startsWith('data:image/png;base64,'),
				'data URL should use base64 encoding for PNG'
			);
		});

		test('parses text/plain as text output', () => {
			const result = parseOutputData(makeOutputItem('text/plain', 'hello'));
			assert.strictEqual(result.type, 'text');
		});

		test('parses stdout as stdout output', () => {
			const result = parseOutputData(makeOutputItem('application/vnd.code.notebook.stdout', 'hello'));
			assert.strictEqual(result.type, 'stdout');
		});
	});

	test('pickPreferredOutputItem: prefers image/svg+xml over text/plain', () => {
		const items = [
			makeOutputItem('text/plain', 'fallback text'),
			makeOutputItem('image/svg+xml', '<svg></svg>'),
		];

		const preferred = pickPreferredOutputItem(items);
		assert.strictEqual(preferred?.mime, 'image/svg+xml');
	});
});
