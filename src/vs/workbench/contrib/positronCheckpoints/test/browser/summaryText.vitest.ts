/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { summaryLines } from '../../browser/components/summaryText.js';

describe('summaryLines', () => {
	test('removes list markers and empty lines', () => {
		expect(summaryLines('- The model includes the site.\n\n* The plot is orange.\n  Notes were added.  ')).toEqual([
			'The model includes the site.',
			'The plot is orange.',
			'Notes were added.',
		]);
	});

	test('keeps a one-line summary as one line, with a hyphen inside it', () => {
		expect(summaryLines('The dose-response model changed.')).toEqual(['The dose-response model changed.']);
	});
});
