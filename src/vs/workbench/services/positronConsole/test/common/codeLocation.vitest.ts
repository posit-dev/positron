/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { fragmentCodeLocation, ICodeLocation } from '../../common/codeLocation.js';

/**
 * Builds a code location for the whole submitted code, starting at the given
 * 0-based line/character.
 */
function wholeLocation(line: number, character: number, endLine: number, endCharacter: number): ICodeLocation {
	return {
		uri: URI.file('/tmp/breakpoint_test.r'),
		range: {
			start: { line, character },
			end: { line: endLine, character: endCharacter },
		},
	};
}

describe('fragmentCodeLocation', () => {
	// A whole-file selection (Cmd+Enter on selectAll) starts at line 0, col 0.
	// Splitting it into per-statement fragments must attribute each fragment to
	// the source lines it came from so a runtime can verify breakpoints.
	const whole = wholeLocation(0, 0, 5, 1);

	it('attributes a single-line fragment to its own source line', () => {
		const location = fragmentCodeLocation(whole, 'x <- 1', 2, 3);
		expect(location.range).toEqual({
			start: { line: 2, character: 0 },
			end: { line: 2, character: 6 },
		});
	});

	it('attributes a multi-line fragment to its full source line span', () => {
		const code = 'multiply_values <- function(x, y) {\n  x * y\n}';
		const location = fragmentCodeLocation(whole, code, 0, 3);
		expect(location.range).toEqual({
			start: { line: 0, character: 0 },
			end: { line: 2, character: 1 },
		});
	});

	it('offsets fragment lines by the whole code start line', () => {
		// Whole selection begins partway down the file (line 10).
		const offset = wholeLocation(10, 0, 13, 0);
		const location = fragmentCodeLocation(offset, 'y <- 2', 1, 2);
		expect(location.range).toEqual({
			start: { line: 11, character: 0 },
			end: { line: 11, character: 6 },
		});
	});

	it('inherits the whole start column only for the first source line', () => {
		// A selection that begins mid-line: the first fragment line keeps the
		// start column; later lines begin at column 0.
		const midLine = wholeLocation(4, 8, 6, 3);
		const first = fragmentCodeLocation(midLine, 'foo()', 0, 1);
		const later = fragmentCodeLocation(midLine, 'bar()', 1, 2);
		expect({ first: first.range, later: later.range }).toEqual({
			first: { start: { line: 4, character: 8 }, end: { line: 4, character: 13 } },
			later: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } },
		});
	});

	it('measures the end column in UTF-8 bytes', () => {
		// A multibyte character (é is 2 bytes in UTF-8) shifts the byte column
		// past the UTF-16 length.
		const location = fragmentCodeLocation(whole, 'x <- "é"', 0, 1);
		expect(location.range.end).toEqual({ line: 0, character: 9 });
	});
});
