/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { displayTitle } from '../../common/checkpointTitle.js';

describe('displayTitle', () => {
	test('keeps a title without git words', () => {
		expect(displayTitle({ title: 'Changed units to mg/kg', authorName: 'Maya' })).toBe('Changed units to mg/kg');
		expect(displayTitle({ title: 'Head of the table', authorName: 'Maya' })).toBe('Head of the table');
	});

	test('replaces a title that begins with Merge by a sentence about combined work', () => {
		expect(displayTitle({ title: 'Merge pull request #12 from x/branch', authorName: 'Maya' })).toBe('Combined work from Maya');
		expect(displayTitle({ title: 'Merged the dose fixes', authorName: 'Maya' })).toBe('Combined work from Maya');
	});

	test('replaces any other title with a git word by a sentence that names the author', () => {
		expect(displayTitle({ title: 'Fix typo before push', authorName: 'Maya' })).toBe('Work from Maya');
		expect(displayTitle({ title: 'WIP on HEAD', authorName: 'Sam' })).toBe('Work from Sam');
	});
});
