/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getFittedSessionName } from '../../common/sessionDisplayUtils.js';

/**
 * Stands in for measuring rendered text, giving every character the same width
 * so that expected widths can be read off the length of a name.
 */
function measureWidth(text: string): number {
	return text.length * 10;
}

describe('getFittedSessionName', () => {
	it('returns the full name unchanged when it fits', () => {
		expect(getFittedSessionName('Python  3.12.11', 1000, measureWidth)).toBe('Python  3.12.11');
	});

	it('ellipsizes the name further as the available width shrinks', () => {
		const sessionName = 'Python 3.12.11 (Pyenv)';
		const fittedNames = [300, 220, 200, 110, 100, 80, 40, 20, 15].map(availableWidth => ({
			availableWidth,
			fittedName: getFittedSessionName(sessionName, availableWidth, measureWidth),
		}));
		expect(fittedNames).toMatchInlineSnapshot(`
			[
			  {
			    "availableWidth": 300,
			    "fittedName": "Python 3.12.11 (Pyenv)",
			  },
			  {
			    "availableWidth": 220,
			    "fittedName": "Python 3.12.11 (Pyenv)",
			  },
			  {
			    "availableWidth": 200,
			    "fittedName": "Python 3.12.11 (Pye…",
			  },
			  {
			    "availableWidth": 110,
			    "fittedName": "Python 3.1…",
			  },
			  {
			    "availableWidth": 100,
			    "fittedName": "Python 3…",
			  },
			  {
			    "availableWidth": 80,
			    "fittedName": "Python…",
			  },
			  {
			    "availableWidth": 40,
			    "fittedName": "Pyt…",
			  },
			  {
			    "availableWidth": 20,
			    "fittedName": "P…",
			  },
			  {
			    "availableWidth": 15,
			    "fittedName": "",
			  },
			]
		`);
	});

	it('trims a trailing separator so the ellipsis never follows punctuation or a symbol', () => {
		expect(getFittedSessionName('Some-word-thing', 110, measureWidth)).toBe('Some-word\u2026');
		expect(getFittedSessionName('R 4.6.0 | x86', 100, measureWidth)).toBe('R 4.6.0\u2026');
	});

	it('returns an empty string when even the first character and the ellipsis will not fit', () => {
		expect(getFittedSessionName('Python', 15, measureWidth)).toBe('');
	});
});
