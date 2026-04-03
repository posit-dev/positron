/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'vitest';
import { expect } from 'vitest';
import {
	parseCellExecutionOptions,
	extractExecutableCode,
	getOptionLineCount,
	DEFAULT_CELL_EXECUTION_OPTIONS
} from '../../common/quartoExecutionOptions.js';

describe('QuartoExecutionOptions', () => {

	describe('parseCellExecutionOptions', () => {
		it('returns defaults for code without options', () => {
			const code = `print("hello")
x = 1 + 2`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(DEFAULT_CELL_EXECUTION_OPTIONS.eval);
			expect(result.options.error).toBe(DEFAULT_CELL_EXECUTION_OPTIONS.error);
			expect(result.optionLineCount).toBe(0);
			expect(result.metadata).toEqual({});
		});

		it('parses eval: false option', () => {
			const code = `#| eval: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.options.error).toBe(true); // default
			expect(result.optionLineCount).toBe(1);
		});

		it('parses eval: true option', () => {
			const code = `#| eval: true
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(true);
			expect(result.optionLineCount).toBe(1);
		});

		it('parses error: false option', () => {
			const code = `#| error: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(true); // default
			expect(result.options.error).toBe(false);
			expect(result.optionLineCount).toBe(1);
		});

		it('parses error: true option', () => {
			const code = `#| error: true
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.error).toBe(true);
			expect(result.optionLineCount).toBe(1);
		});

		it('parses multiple options', () => {
			const code = `#| eval: false
#| error: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.options.error).toBe(false);
			expect(result.optionLineCount).toBe(2);
		});

		it('handles options with leading whitespace', () => {
			const code = `  #| eval: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.optionLineCount).toBe(1);
		});

		it('handles option line without space after #|', () => {
			const code = `#|eval: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.optionLineCount).toBe(1);
		});

		it('stops parsing at first non-option line', () => {
			const code = `#| eval: false
print("hello")
#| error: false`;
			const result = parseCellExecutionOptions(code);

			// The second #| line should be ignored since it comes after non-option content
			expect(result.options.eval).toBe(false);
			expect(result.options.error).toBe(true); // default, second option not parsed
			expect(result.optionLineCount).toBe(1);
		});

		it('collects non-execution options as metadata', () => {
			const code = `#| label: my-cell
#| eval: false
#| fig-width: 10
print("hello")`;
			const result = parseCellExecutionOptions(code);

			// Only eval and error are relevant for execution options
			expect(result.options.eval).toBe(false);
			expect(result.options.error).toBe(true); // default
			expect(result.optionLineCount).toBe(3);
			expect(result.metadata).toEqual({ 'label': 'my-cell', 'fig-width': 10 });
		});

		it('returns empty metadata when only execution options present', () => {
			const code = `#| eval: false
#| error: false
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.options.error).toBe(false);
			expect(result.metadata).toEqual({});
		});

		it('handles empty code', () => {
			const result = parseCellExecutionOptions('');

			expect(result.options.eval).toBe(DEFAULT_CELL_EXECUTION_OPTIONS.eval);
			expect(result.options.error).toBe(DEFAULT_CELL_EXECUTION_OPTIONS.error);
			expect(result.optionLineCount).toBe(0);
			expect(result.metadata).toEqual({});
		});

		it('handles code with only options', () => {
			const code = `#| eval: false`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.optionLineCount).toBe(1);
		});

		it('handles options with extra whitespace around values', () => {
			const code = `#|  eval:   false
#|  error:   true
print("hello")`;
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.options.error).toBe(true);
			expect(result.optionLineCount).toBe(2);
		});

		it('handles CRLF line endings (Windows)', () => {
			const code = '#| fig-width: 4\r\n#| fig-height: 3\r\nprint("hello")';
			const result = parseCellExecutionOptions(code);

			expect(result.optionLineCount).toBe(2);
			expect(result.metadata).toEqual({ 'fig-width': 4, 'fig-height': 3 });
		});

		it('handles CR-only line endings', () => {
			const code = '#| eval: false\r#| fig-width: 10\rprint("hello")';
			const result = parseCellExecutionOptions(code);

			expect(result.options.eval).toBe(false);
			expect(result.optionLineCount).toBe(2);
			expect(result.metadata).toEqual({ 'fig-width': 10 });
		});
	});

	describe('extractExecutableCode', () => {
		it('returns full code when no options present', () => {
			const code = `print("hello")
x = 1 + 2`;
			const result = extractExecutableCode(code);

			expect(result).toBe(code);
		});

		it('removes single option line', () => {
			const code = `#| eval: false
print("hello")`;
			const result = extractExecutableCode(code);

			expect(result).toBe('print("hello")');
		});

		it('removes multiple option lines', () => {
			const code = `#| eval: false
#| error: false
#| label: test
print("hello")
x = 1`;
			const result = extractExecutableCode(code);

			expect(result).toBe(`print("hello")
x = 1`);
		});

		it('handles empty code', () => {
			const result = extractExecutableCode('');

			expect(result).toBe('');
		});

		it('returns empty string when code is only options', () => {
			const code = `#| eval: false
#| error: false`;
			const result = extractExecutableCode(code);

			expect(result).toBe('');
		});

		it('removes option lines with CRLF line endings', () => {
			const code = '#| eval: false\r\n#| fig-width: 4\r\nprint("hello")';
			const result = extractExecutableCode(code);

			expect(result).toBe('print("hello")');
		});

		it('preserves internal #| comments (not at start)', () => {
			const code = `print("hello")
#| this is a comment in the middle
x = 1`;
			const result = extractExecutableCode(code);

			// Middle #| should be preserved since it's not at the start
			expect(result).toBe(code);
		});
	});

	describe('getOptionLineCount', () => {
		it('returns 0 for code without options', () => {
			const code = `print("hello")`;
			expect(getOptionLineCount(code)).toBe(0);
		});

		it('returns correct count for single option', () => {
			const code = `#| eval: false
print("hello")`;
			expect(getOptionLineCount(code)).toBe(1);
		});

		it('returns correct count for multiple options', () => {
			const code = `#| eval: false
#| error: false
#| label: test
print("hello")`;
			expect(getOptionLineCount(code)).toBe(3);
		});

		it('returns 0 for empty code', () => {
			expect(getOptionLineCount('')).toBe(0);
		});
	});

	describe('DEFAULT_CELL_EXECUTION_OPTIONS', () => {
		it('has correct default values', () => {
			expect(DEFAULT_CELL_EXECUTION_OPTIONS.eval).toBe(true);
			expect(DEFAULT_CELL_EXECUTION_OPTIONS.error).toBe(true);
		});
	});
});
