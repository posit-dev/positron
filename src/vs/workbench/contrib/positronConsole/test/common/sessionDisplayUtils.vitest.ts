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
		const fittedNames = [300, 220, 200, 110, 100, 80, 40, 30].map(availableWidth => ({
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
			    "availableWidth": 30,
			    "fittedName": "",
			  },
			]
		`);
	});

	it('trims a trailing separator so the ellipsis never follows punctuation', () => {
		expect(getFittedSessionName('Some-word-thing', 110, measureWidth)).toBe('Some-word\u2026');
	});

	it('returns an empty string when fewer than three characters would be left', () => {
		expect(getFittedSessionName('Python', 30, measureWidth)).toBe('');
	});
});
