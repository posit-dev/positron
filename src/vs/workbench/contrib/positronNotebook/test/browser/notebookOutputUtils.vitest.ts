/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { DATA_EXPLORER_MIME_TYPE, parseOutputData } from '../../browser/getOutputContents.js';
import { ParsedDataExplorerOutput } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { pickPreferredOutputItem } from '../../browser/PositronNotebookCells/notebookOutputUtils.js';
import { parseVariablePath } from '../../../../services/positronDataExplorer/common/utils.js';

function makeOutputItem(mime: string, text: string) {
	return { mime, data: VSBuffer.fromString(text) };
}

describe('Notebook Output Utils', () => {
	createTestContainer().build();

	describe('parseOutputData', () => {
		it('parses image/svg+xml into an image with a data URL', () => {
			const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
			const result = parseOutputData(makeOutputItem('image/svg+xml', svg));

			expect(result.type).toBe('image');
			const { dataUrl } = result as { type: 'image'; dataUrl: string };
			expect(
				dataUrl.startsWith('data:image/svg+xml,')
			).toBeTruthy();
			expect(
				dataUrl.includes(encodeURIComponent(svg))
			).toBeTruthy();
		});

		it('parses image/png into an image with a base64 data URL', () => {
			const pngData = 'iVBORw0KGgo='; // stub PNG header
			const result = parseOutputData(makeOutputItem('image/png', pngData));

			expect(result.type).toBe('image');
			const { dataUrl } = result as { type: 'image'; dataUrl: string };
			expect(
				dataUrl.startsWith('data:image/png;base64,')
			).toBeTruthy();
			// The stub bytes are base64-encoded by parseOutputData, so verify
			// the full data URL matches the expected encoding of the input bytes.
			expect(dataUrl).toBe(
				'data:image/png;base64,aVZCT1J3MEtHZ289'
			);
		});

		it('parses text/plain as text output', () => {
			const result = parseOutputData(makeOutputItem('text/plain', 'hello'));
			expect(result.type).toBe('text');
		});

		it('parses stdout as stdout output', () => {
			const result = parseOutputData(makeOutputItem('application/vnd.code.notebook.stdout', 'hello'));
			expect(result.type).toBe('stdout');
		});
	});

	it('pickPreferredOutputItem: prefers image/svg+xml over text/plain', () => {
		const items = [
			makeOutputItem('text/plain', 'fallback text'),
			makeOutputItem('image/svg+xml', '<svg></svg>'),
		];

		const preferred = pickPreferredOutputItem(items);
		expect(preferred?.mime).toBe('image/svg+xml');
	});

	describe('parseOutputData: data explorer MIME type', () => {
		const validPayload = JSON.stringify({
			comm_id: 'test-comm-id',
			shape: [5, 3],
			title: 'my_df',
			version: 1,
			source: 'inline',
			variable_path: ['my_df'],
		});

		it('parses data explorer MIME with variable_path', () => {
			const result = parseOutputData(makeOutputItem(DATA_EXPLORER_MIME_TYPE, validPayload));
			expect(result.type).toBe('dataExplorer');
			const de = result as ParsedDataExplorerOutput;
			expect(de.commId).toBe('test-comm-id');
			expect(de.shape).toEqual([5, 3]);
			expect(de.title).toBe('my_df');
			expect(de.version).toBe(1);
			expect(de.source).toBe('inline');
			expect(de.variablePath).toEqual(['my_df']);
		});

		it('parses data explorer MIME without variable_path', () => {
			const payload = JSON.stringify({ comm_id: 'id', shape: [1, 1], title: 't', version: 1, source: 's' });
			const result = parseOutputData(makeOutputItem(DATA_EXPLORER_MIME_TYPE, payload));
			expect(result.type).toBe('dataExplorer');
			const de = result as ParsedDataExplorerOutput;
			expect(de.variablePath).toBe(undefined);
		});

		it('invalid JSON with data explorer MIME falls through to unknown', () => {
			const result = parseOutputData(makeOutputItem(DATA_EXPLORER_MIME_TYPE, 'not-json'));
			expect(result.type).toBe('unknown');
		});

		it('case-insensitive MIME matching', () => {
			const uppercaseMime = 'Application/Vnd.Positron.DataExplorer+JSON';
			const result = parseOutputData(makeOutputItem(uppercaseMime, validPayload));
			expect(result.type).toBe('dataExplorer');
		});
	});

	describe('parseVariablePath', () => {
		it('valid string array returns the array', () => {
			expect(parseVariablePath(['a', 'b'])).toEqual(['a', 'b']);
		});

		it('non-array string returns undefined', () => {
			expect(parseVariablePath('not-an-array')).toBe(undefined);
		});

		it('non-array number returns undefined', () => {
			expect(parseVariablePath(42)).toBe(undefined);
		});

		it('null returns undefined', () => {
			expect(parseVariablePath(null)).toBe(undefined);
		});

		it('mixed-type array returns undefined', () => {
			expect(parseVariablePath(['a', 1])).toBe(undefined);
		});

		it('undefined input returns undefined', () => {
			expect(parseVariablePath(undefined)).toBe(undefined);
		});

		it('empty array returns empty array', () => {
			expect(parseVariablePath([])).toEqual([]);
		});
	});
});
