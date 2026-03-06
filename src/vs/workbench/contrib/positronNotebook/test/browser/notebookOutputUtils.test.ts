/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DATA_EXPLORER_MIME_TYPE, parseOutputData } from '../../browser/getOutputContents.js';
import { ParsedDataExplorerOutput } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { pickPreferredOutputItem } from '../../browser/PositronNotebookCells/notebookOutputUtils.js';
import { parseVariablePath } from '../../../../services/positronDataExplorer/common/utils.js';

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

	suite('parseOutputData: data explorer MIME type', () => {
		const validPayload = JSON.stringify({
			comm_id: 'test-comm-id',
			shape: [5, 3],
			title: 'my_df',
			version: 1,
			source: 'inline',
			variable_path: ['my_df'],
		});

		test('parses data explorer MIME with variable_path', () => {
			const result = parseOutputData(makeOutputItem(DATA_EXPLORER_MIME_TYPE, validPayload));
			assert.strictEqual(result.type, 'dataExplorer');
			const de = result as ParsedDataExplorerOutput;
			assert.strictEqual(de.commId, 'test-comm-id');
			assert.deepStrictEqual(de.shape, [5, 3]);
			assert.strictEqual(de.title, 'my_df');
			assert.strictEqual(de.version, 1);
			assert.strictEqual(de.source, 'inline');
			assert.deepStrictEqual(de.variablePath, ['my_df']);
		});

		test('parses data explorer MIME without variable_path', () => {
			const payload = JSON.stringify({ comm_id: 'id', shape: [1, 1], title: 't', version: 1, source: 's' });
			const result = parseOutputData(makeOutputItem(DATA_EXPLORER_MIME_TYPE, payload));
			assert.strictEqual(result.type, 'dataExplorer');
			const de = result as ParsedDataExplorerOutput;
			assert.strictEqual(de.variablePath, undefined);
		});

		test('invalid JSON with data explorer MIME falls through to unknown', () => {
			const result = parseOutputData(makeOutputItem(DATA_EXPLORER_MIME_TYPE, 'not-json'));
			assert.strictEqual(result.type, 'unknown');
		});

		test('case-insensitive MIME matching', () => {
			const uppercaseMime = 'Application/Vnd.Positron.DataExplorer+JSON';
			const result = parseOutputData(makeOutputItem(uppercaseMime, validPayload));
			assert.strictEqual(result.type, 'dataExplorer');
		});
	});

	suite('parseVariablePath', () => {
		test('valid string array returns the array', () => {
			assert.deepStrictEqual(parseVariablePath(['a', 'b']), ['a', 'b']);
		});

		test('non-array string returns undefined', () => {
			assert.strictEqual(parseVariablePath('not-an-array'), undefined);
		});

		test('non-array number returns undefined', () => {
			assert.strictEqual(parseVariablePath(42), undefined);
		});

		test('null returns undefined', () => {
			assert.strictEqual(parseVariablePath(null), undefined);
		});

		test('mixed-type array returns undefined', () => {
			assert.strictEqual(parseVariablePath(['a', 1]), undefined);
		});

		test('undefined input returns undefined', () => {
			assert.strictEqual(parseVariablePath(undefined), undefined);
		});

		test('empty array returns empty array', () => {
			assert.deepStrictEqual(parseVariablePath([]), []);
		});
	});
});
