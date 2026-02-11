/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	parseCellExecutionOptions,
	extractExecutableCode,
	getOptionLineCount,
	DEFAULT_CELL_EXECUTION_OPTIONS
} from '../../common/quartoExecutionOptions.js';

suite('QuartoExecutionOptions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parseCellExecutionOptions', () => {
		test('returns defaults for code without options', () => {
			const code = `print("hello")
x = 1 + 2`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, DEFAULT_CELL_EXECUTION_OPTIONS.eval);
			assert.strictEqual(result.options.error, DEFAULT_CELL_EXECUTION_OPTIONS.error);
			assert.strictEqual(result.optionLineCount, 0);
		});

		test('parses eval: false option', () => {
			const code = `#| eval: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.options.error, true); // default
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('parses eval: true option', () => {
			const code = `#| eval: true
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, true);
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('parses error: false option', () => {
			const code = `#| error: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, true); // default
			assert.strictEqual(result.options.error, false);
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('parses error: true option', () => {
			const code = `#| error: true
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.error, true);
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('parses multiple options', () => {
			const code = `#| eval: false
#| error: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.options.error, false);
			assert.strictEqual(result.optionLineCount, 2);
		});

		test('handles options with leading whitespace', () => {
			const code = `  #| eval: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('handles option line without space after #|', () => {
			const code = `#|eval: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('stops parsing at first non-option line', () => {
			const code = `#| eval: false
print("hello")
#| error: false`;
			const result = parseCellExecutionOptions(code);

			// The second #| line should be ignored since it comes after non-option content
			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.options.error, true); // default, second option not parsed
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('ignores unknown options', () => {
			const code = `#| label: my-cell
#| eval: false
#| fig-width: 10
print("hello")`;
			const result = parseCellExecutionOptions(code);

			// Only eval and error are relevant for execution options
			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.options.error, true); // default
			assert.strictEqual(result.optionLineCount, 3);
		});

		test('handles empty code', () => {
			const result = parseCellExecutionOptions('');

			assert.strictEqual(result.options.eval, DEFAULT_CELL_EXECUTION_OPTIONS.eval);
			assert.strictEqual(result.options.error, DEFAULT_CELL_EXECUTION_OPTIONS.error);
			assert.strictEqual(result.optionLineCount, 0);
		});

		test('handles code with only options', () => {
			const code = `#| eval: false`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.optionLineCount, 1);
		});

		test('handles options with extra whitespace around values', () => {
			const code = `#|  eval:   false
#|  error:   true
print("hello")`;
			const result = parseCellExecutionOptions(code);

			assert.strictEqual(result.options.eval, false);
			assert.strictEqual(result.options.error, true);
			assert.strictEqual(result.optionLineCount, 2);
		});
	});

	suite('extractExecutableCode', () => {
		test('returns full code when no options present', () => {
			const code = `print("hello")
x = 1 + 2`;
			const result = extractExecutableCode(code);

			assert.strictEqual(result, code);
		});

		test('removes single option line', () => {
			const code = `#| eval: false
print("hello")`;
			const result = extractExecutableCode(code);

			assert.strictEqual(result, 'print("hello")');
		});

		test('removes multiple option lines', () => {
			const code = `#| eval: false
#| error: false
#| label: test
print("hello")
x = 1`;
			const result = extractExecutableCode(code);

			assert.strictEqual(result, `print("hello")
x = 1`);
		});

		test('handles empty code', () => {
			const result = extractExecutableCode('');

			assert.strictEqual(result, '');
		});

		test('returns empty string when code is only options', () => {
			const code = `#| eval: false
#| error: false`;
			const result = extractExecutableCode(code);

			assert.strictEqual(result, '');
		});

		test('preserves internal #| comments (not at start)', () => {
			const code = `print("hello")
#| this is a comment in the middle
x = 1`;
			const result = extractExecutableCode(code);

			// Middle #| should be preserved since it's not at the start
			assert.strictEqual(result, code);
		});
	});

	suite('getOptionLineCount', () => {
		test('returns 0 for code without options', () => {
			const code = `print("hello")`;
			assert.strictEqual(getOptionLineCount(code), 0);
		});

		test('returns correct count for single option', () => {
			const code = `#| eval: false
print("hello")`;
			assert.strictEqual(getOptionLineCount(code), 1);
		});

		test('returns correct count for multiple options', () => {
			const code = `#| eval: false
#| error: false
#| label: test
print("hello")`;
			assert.strictEqual(getOptionLineCount(code), 3);
		});

		test('returns 0 for empty code', () => {
			assert.strictEqual(getOptionLineCount(''), 0);
		});
	});

	suite('DEFAULT_CELL_EXECUTION_OPTIONS', () => {
		test('has correct default values', () => {
			assert.strictEqual(DEFAULT_CELL_EXECUTION_OPTIONS.eval, true);
			assert.strictEqual(DEFAULT_CELL_EXECUTION_OPTIONS.error, true);
		});
	});
});
