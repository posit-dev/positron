/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { DATA_EXPLORER_MIME_TYPE, parseOutputData } from '../../browser/getOutputContents.js';
import { ParsedDataExplorerOutput } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { HtmlRenderMode, htmlRenderMode, pickPreferredOutputItem } from '../../browser/PositronNotebookCells/notebookOutputUtils.js';
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
				dataUrl.startsWith('data:image/svg+xml,'),
				'data URL should use the svg+xml MIME type'
			).toBe(true);
			expect(dataUrl, 'data URL should contain the URI-encoded SVG markup').toContain(encodeURIComponent(svg));
		});

		it('parses image/png into an image with a base64 data URL', () => {
			const pngData = 'iVBORw0KGgo='; // stub PNG header
			const result = parseOutputData(makeOutputItem('image/png', pngData));

			expect(result.type).toBe('image');
			const { dataUrl } = result as { type: 'image'; dataUrl: string };
			expect(
				dataUrl.startsWith('data:image/png;base64,'),
				'data URL should use base64 encoding for PNG'
			).toBe(true);
			// The stub bytes are base64-encoded by parseOutputData, so verify
			// the full data URL matches the expected encoding of the input bytes.
			expect(dataUrl, 'data URL payload should be the base64 encoding of the input buffer bytes').toBe(
				'data:image/png;base64,aVZCT1J3MEtHZ289'
			);
		});

		it('retina dimensions are not lost on save/reload', () => {
			// Simulate execution: runtimeNotebookCellExecution stores the message's
			// output-level metadata (message.outputMetadata) under a nested
			// `metadata` key in output.metadata
			const messageOutputMetadata = { 'image/png': { width: 320, height: 240 } };
			const outputMetadata = {
				outputType: 'display_data',
				executionCount: 1,
				metadata: messageOutputMetadata,
			};

			// Simulate save: ipynb serializer reads output.metadata.metadata
			// (extensions/ipynb/src/serializers.ts line 183)
			const savedToIpynb = outputMetadata.metadata;
			expect(savedToIpynb).toEqual({ 'image/png': { width: 320, height: 240 } });

			// Simulate reload: ipynb deserializer stores output.metadata under
			// metadata.metadata (extensions/ipynb/src/deserializers.ts line 205)
			const loadedOutputMetadata = {
				outputType: 'display_data',
				executionCount: 1,
				metadata: JSON.parse(JSON.stringify(savedToIpynb)),
			};

			// Verify parseOutputData can read dimensions from the reloaded structure
			const pngData = 'iVBORw0KGgo=';
			const result = parseOutputData(makeOutputItem('image/png', pngData), loadedOutputMetadata);
			expect(result.type).toBe('image');
			const img = result as { type: 'image'; dataUrl: string; width?: number; height?: number };
			expect(img.width).toBe(320);
			expect(img.height).toBe(240);
		});

		it('images already saved in a notebook get retina sizing', () => {
			// An ipynb file on disk has retina metadata in the Jupyter format:
			// { "output_type": "display_data", "metadata": {"image/png": {"width": 160, "height": 80}} }
			// After deserialization, output.metadata looks like:
			const loadedMetadata = {
				outputType: 'display_data',
				metadata: { 'image/png': { width: 160, height: 80 } },
			};

			const pngData = 'iVBORw0KGgo=';
			const result = parseOutputData(makeOutputItem('image/png', pngData), loadedMetadata);
			expect(result.type).toBe('image');
			const img = result as { type: 'image'; dataUrl: string; width?: number; height?: number };
			expect(img.width).toBe(160);
			expect(img.height).toBe(80);
		});

		it('parses image/png without metadata into an image with no dimensions', () => {
			const pngData = 'iVBORw0KGgo=';
			const result = parseOutputData(makeOutputItem('image/png', pngData));

			expect(result.type).toBe('image');
			const img = result as { type: 'image'; dataUrl: string; width?: number; height?: number };
			expect(img.width).toBeUndefined();
			expect(img.height).toBeUndefined();
		});

		it('parses text/plain as text output', () => {
			const result = parseOutputData(makeOutputItem('text/plain', 'hello'));
			expect(result.type).toBe('text');
		});

		it('parses stdout as stdout output', () => {
			const result = parseOutputData(makeOutputItem('application/vnd.code.notebook.stdout', 'hello'));
			expect(result.type).toBe('stdout');
		});

		it('parses notebook error MIME as error output', () => {
			const result = parseOutputData(makeOutputItem(
				'application/vnd.code.notebook.error',
				JSON.stringify({ name: 'Error', message: 'failed', stack: 'stack trace' })
			));

			expect(result.type).toBe('error');
			if (result.type === 'error') {
				expect(result.content).toBe('stack trace');
			}
		});

		it('parses text/latex as latex output', () => {
			const latex = '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}';
			const result = parseOutputData(makeOutputItem('text/latex', latex));
			expect(result).toEqual({ type: 'latex', content: latex });
		});

		it('parses text/markdown as markdown output', () => {
			const result = parseOutputData(makeOutputItem('text/markdown', '# Hello'));
			expect(result).toEqual({ type: 'markdown', content: '# Hello' });
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

	it('pickPreferredOutputItem: prefers text/latex over text/plain', () => {
		const items = [
			makeOutputItem('text/plain', 'E = mc^2'),
			makeOutputItem('text/latex', '$E = mc^2$'),
		];

		const preferred = pickPreferredOutputItem(items);
		expect(preferred?.mime).toBe('text/latex');
	});

	it('pickPreferredOutputItem: prefers text/latex over text/markdown', () => {
		const items = [
			makeOutputItem('text/markdown', '# Math'),
			makeOutputItem('text/latex', '$E = mc^2$'),
		];

		const preferred = pickPreferredOutputItem(items);
		expect(preferred?.mime).toBe('text/latex');
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

	describe('htmlRenderMode', () => {
		const cases: [HtmlRenderMode, string, string][] = [
			// Active content is isolated in a webview.
			['webview', 'script', '<div><script>alert(1)</script></div>'],
			['webview', 'iframe', '<iframe src="https://example.com"></iframe>'],
			['webview', 'event handler', '<img src="x" onerror="alert(1)">'],
			['webview', 'full document with a script', '<!DOCTYPE html><html><body><script>x()</script></body></html>'],
			// Inert full documents render inline in a shadow root.
			['shadowRoot', 'doctype', '<!DOCTYPE html><html></html>'],
			['shadowRoot', 'html tag', '<html><p>Hello</p></html>'],
			['shadowRoot', 'body tag', '<body><p>Hello</p></body>'],
			// Inert fragments render inline via renderHtml.
			['fragment', 'simple fragment', '<p>Hello world</p>'],
			['fragment', 'data attribute with "on" prefix', '<div data-onclick="value">test</div>'],
		];

		for (const [mode, label, html] of cases) {
			it(`routes ${label} to ${mode}`, () => {
				expect(htmlRenderMode(html)).toBe(mode);
			});
		}
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
