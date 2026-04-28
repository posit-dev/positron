/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseVizSuggestion } from '../visualizationSuggestions.js';

function mockLog(): vscode.LogOutputChannel {
	return {
		debug: () => { },
		info: () => { },
		warn: () => { },
		error: () => { },
		trace: () => { },
	} as unknown as vscode.LogOutputChannel;
}

const COLUMNS = [
	{ name: 'price', type: 'float64' },
	{ name: 'region', type: 'object' },
];

const VALID_JSON = JSON.stringify({
	library: 'plotly',
	chartType: 'bar',
	xCol: 'region',
	yCol: 'price',
	reasoning: {
		library: 'plotly imported in notebook',
		chartType: 'categorical vs numeric',
		columns: 'region (category) vs price (numeric)',
	},
});

suite('parseVizSuggestion', () => {
	const log = mockLog();

	test('parses a well-formed JSON payload', () => {
		const result = parseVizSuggestion(VALID_JSON, COLUMNS, log);
		assert.ok(result);
		assert.strictEqual(result.library, 'plotly');
		assert.strictEqual(result.chartType, 'bar');
		assert.strictEqual(result.xCol, 'region');
		assert.strictEqual(result.yCol, 'price');
		assert.strictEqual(result.reasoning.library, 'plotly imported in notebook');
	});

	test('strips ```json fences', () => {
		const raw = '```json\n' + VALID_JSON + '\n```';
		const result = parseVizSuggestion(raw, COLUMNS, log);
		assert.ok(result);
		assert.strictEqual(result.library, 'plotly');
	});

	test('ignores prose surrounding the JSON object', () => {
		const raw = 'Sure, here is my suggestion:\n' + VALID_JSON + '\nHope that helps!';
		const result = parseVizSuggestion(raw, COLUMNS, log);
		assert.ok(result);
		assert.strictEqual(result.chartType, 'bar');
	});

	test('returns empty reasoning strings when reasoning fields are missing', () => {
		const raw = JSON.stringify({
			library: 'matplotlib',
			chartType: 'scatter',
			xCol: 'price',
			yCol: null,
			reasoning: {},
		});
		const result = parseVizSuggestion(raw, COLUMNS, log);
		assert.ok(result);
		assert.strictEqual(result.reasoning.library, '');
		assert.strictEqual(result.reasoning.chartType, '');
		assert.strictEqual(result.reasoning.columns, '');
	});

	test('returns null for an unknown library', () => {
		const raw = JSON.stringify({ ...JSON.parse(VALID_JSON), library: 'ggplot2' });
		assert.strictEqual(parseVizSuggestion(raw, COLUMNS, log), null);
	});

	test('returns null for an unknown chart type', () => {
		const raw = JSON.stringify({ ...JSON.parse(VALID_JSON), chartType: 'heatmap' });
		assert.strictEqual(parseVizSuggestion(raw, COLUMNS, log), null);
	});

	test('falls back to first column when xCol is not in the provided list', () => {
		const raw = JSON.stringify({ ...JSON.parse(VALID_JSON), xCol: 'nonexistent' });
		const result = parseVizSuggestion(raw, COLUMNS, log);
		assert.ok(result);
		assert.strictEqual(result.xCol, 'price'); // first column name in COLUMNS
	});

	test('discards yCol that is not in the provided list', () => {
		const raw = JSON.stringify({ ...JSON.parse(VALID_JSON), yCol: 'missing' });
		const result = parseVizSuggestion(raw, COLUMNS, log);
		assert.ok(result);
		assert.strictEqual(result.yCol, null);
	});

	test('returns null for completely malformed input', () => {
		assert.strictEqual(parseVizSuggestion('not json at all', COLUMNS, log), null);
		assert.strictEqual(parseVizSuggestion('', COLUMNS, log), null);
		assert.strictEqual(parseVizSuggestion('{', COLUMNS, log), null);
	});

	test('returns null when xCol is invalid and no columns are provided', () => {
		const raw = JSON.stringify({ ...JSON.parse(VALID_JSON), xCol: 'nonexistent' });
		assert.strictEqual(parseVizSuggestion(raw, [], log), null);
	});
});
