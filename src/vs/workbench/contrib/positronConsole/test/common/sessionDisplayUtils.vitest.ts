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

	it('drops a trailing word at a time as the available width shrinks', () => {
		const sessionName = 'Python 3.12.11 (Pyenv)';
		const fittedNames = [300, 220, 200, 140, 100, 60, 50].map(availableWidth => ({
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
			    "fittedName": "Python 3.12.11",
			  },
			  {
			    "availableWidth": 140,
			    "fittedName": "Python 3.12.11",
			  },
			  {
			    "availableWidth": 100,
			    "fittedName": "Python",
			  },
			  {
			    "availableWidth": 60,
			    "fittedName": "Python",
			  },
			  {
			    "availableWidth": 50,
			    "fittedName": "",
			  },
			]
		`);
	});

	it('returns an empty string for a single-word name that does not fit', () => {
		expect(getFittedSessionName('Python', 50, measureWidth)).toBe('');
	});
});
