/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { extractAppUrlFromString } from '../api-utils';

suite('extractAppUrlFromString', () => {
	test('matches all builtin app URL patterns', () => {
		const cases: Array<{ name: string; output: string; patterns: string[]; expected: string }> = [
			{
				name: 'Shiny',
				output: 'Listening on http://127.0.0.1:52464',
				patterns: ['Listening on {{APP_URL}}'],
				expected: 'http://127.0.0.1:52464',
			},
			{
				name: 'Dash',
				output: 'Dash is running on http://127.0.0.1:8050/',
				patterns: ['Dash is running on {{APP_URL}}'],
				expected: 'http://127.0.0.1:8050/',
			},
			{
				name: 'FastAPI',
				output: 'Uvicorn running on http://127.0.0.1:8000',
				patterns: ['Uvicorn running on {{APP_URL}}'],
				expected: 'http://127.0.0.1:8000',
			},
			{
				name: 'Flask',
				output: ' * Running on http://127.0.0.1:5000',
				patterns: ['Running on {{APP_URL}}'],
				expected: 'http://127.0.0.1:5000',
			},
			{
				name: 'Gradio',
				output: 'Running on local URL:  http://127.0.0.1:7860',
				patterns: ['Running on local URL:  {{APP_URL}}', 'Running on public URL:  {{APP_URL}}'],
				expected: 'http://127.0.0.1:7860',
			},
			{
				name: 'Streamlit',
				output: '  Local URL: http://localhost:8501',
				patterns: ['Local URL: {{APP_URL}}'],
				expected: 'http://localhost:8501',
			},
		];

		for (const { name, output, patterns, expected } of cases) {
			const result = extractAppUrlFromString(output, patterns);
			assert.strictEqual(result, expected, `Failed for ${name}`);
		}
	});

	// https://github.com/posit-dev/positron/issues/13229
	test('does not match unrelated URLs when appUrlStrings are provided (#13229)', () => {
		const result = extractAppUrlFromString(
			'You can use shinyjs to call your own JavaScript functions:\n\thttps://deanattali.com/shinyjs/extend',
			['Listening on {{APP_URL}}'],
		);
		assert.strictEqual(result, undefined);
	});

	test('falls back to generic HTTP URL matching when no appUrlStrings provided', () => {
		const result = extractAppUrlFromString('Server at http://127.0.0.1:8080');
		assert.strictEqual(result, 'http://127.0.0.1:8080');
	});

	test('returns undefined when no URL present and no appUrlStrings', () => {
		const result = extractAppUrlFromString('no urls here');
		assert.strictEqual(result, undefined);
	});
});
